import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarSupabaseDemo } from '../demo/supabase-demo.js';
import { criarApi, linkRecibo, linkAvaliacao, montarMensagemStatus } from '../js/rita-api.js';

// Avaliações dos pedidos (sql/avaliacoes.sql): o convite no WhatsApp e o caminho inteiro na demonstração,
// que imita o banco (o mesmo SQL foi testado num Postgres de verdade antes de ir para sql/).

test('o convite para avaliar vai na mensagem de retirado e de entregue, só com o banco pronto', () => {
  const url = linkRecibo('abc-123', 'https://www.ritabolos.com/');
  assert.equal(linkAvaliacao(url), 'https://www.ritabolos.com/avaliar.html?t=abc-123');
  assert.equal(linkAvaliacao('recibo.html?t=x&demo'), 'avaliar.html?t=x&demo');
  const p = { codigo: 'RB-01042', cliente_nome: 'Maria Souza', data_retirada: '2026-10-19', saldo: 0, itens: [] };
  const comBanco = { avaliacoes_site: false }, semBanco = {};
  for (const codigo of ['retirado', 'entregue']) {
    assert.ok(montarMensagemStatus(p, { codigo }, url, comBanco).includes('https://www.ritabolos.com/avaliar.html?t=abc-123'), codigo);
    assert.ok(!montarMensagemStatus(p, { codigo }, url, semBanco).includes('avaliar.html'), `${codigo} sem o sql/avaliacoes.sql`);
  }
  for (const codigo of ['confirmado', 'pronto', 'cancelado'])
    assert.ok(!montarMensagemStatus(p, { codigo }, url, comBanco).includes('avaliar.html'), codigo);
});

test('o cliente avalia o pedido retirado; a Administração publica; o site mostra só o primeiro nome', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
  const api = criarApi(criarSupabaseDemo({}));
  await api.auth.entrar('rita@demo.com.br', 'demo');

  // a aba do site começa desligada e já há avaliações de exemplo (3 publicadas)
  assert.equal((await api.cardapio.obter()).configuracoes.avaliacoes_site, false);
  const antes = await api.avaliacoes.publicadas();
  assert.equal(antes.total, 3);
  assert.ok(antes.avaliacoes.every(a => /^\p{L}+( \p{Lu}\.)?$/u.test(a.nome)), 'no site: "Fernanda R."');

  const pedido = await api.admin.pedidos.criar({ cliente_nome: 'Maria Aparecida dos Santos', data_retirada: '2026-10-18', hora_retirada: '10:00',
    itens: [{ produto_slug: 'docinho-brigadeiro-cento', quantidade: 1 }] });
  const { token } = await api.admin.pedidos.obter(pedido.id);
  let r = await api.avaliacoes.doPedido(token);
  assert.equal(r.nome, 'Maria');
  assert.equal(r.pode_avaliar, false, 'antes de retirar não dá para avaliar');
  await assert.rejects(api.avaliacoes.enviar(token, { nota: 5 }), /retirado ou entregue/);
  assert.equal(await api.avaliacoes.doPedido('link-errado'), null);

  await api.admin.pedidos.alterarStatus(pedido.id, 'retirado');
  assert.equal((await api.avaliacoes.doPedido(token)).pode_avaliar, true);
  await assert.rejects(api.avaliacoes.enviar(token, { nota: 6 }), /1 a 5/);
  r = await api.avaliacoes.enviar(token, { nota: 5, comentario: '  Perfeito!  ' });
  assert.deepEqual({ nota: r.avaliacao.nota, comentario: r.avaliacao.comentario, situacao: r.avaliacao.situacao }, { nota: 5, comentario: 'Perfeito!', situacao: 'nova' });
  const aviso = (await api.admin.notificacoes.listar({ limite: 5 })).find(n => n.tipo === 'avaliacao');
  assert.equal(aviso?.titulo, 'Avaliação nova: 5 estrelas');

  // a Administração publica; o site passa a mostrar
  const minha = (await api.admin.avaliacoes.listar()).find(a => a.pedido_id === pedido.id);
  assert.equal(await api.admin.avaliacoes.novas(), 4);
  const pub = await api.admin.avaliacoes.definirSituacao(minha.id, 'publicada');
  assert.ok(pub.publicada_em);
  let site = await api.avaliacoes.publicadas();
  assert.equal(site.total, 4);
  assert.equal(site.avaliacoes[0].nome, 'Maria S.');
  assert.equal('itens' in site.avaliacoes[0], false, 'o site não recebe o que a pessoa pediu');

  // o cliente muda o que escreveu: volta a ser nova e sai do site
  await api.avaliacoes.enviar(token, { nota: 4, comentario: 'Muito bom, mas atrasou.' });
  assert.equal((await api.admin.avaliacoes.listar()).find(a => a.id === minha.id).situacao, 'nova');
  assert.equal((await api.avaliacoes.publicadas()).total, 3);

  // sem a autorização do cliente não publica
  await api.avaliacoes.enviar(token, { nota: 4, comentario: 'Muito bom, mas atrasou.', podePublicar: false });
  await assert.rejects(api.admin.avaliacoes.definirSituacao(minha.id, 'publicada'), /não autorizou/);
  assert.equal((await api.admin.avaliacoes.definirSituacao(minha.id, 'oculta')).publicada_em, null);
  await api.admin.avaliacoes.remover(minha.id);
  assert.ok(!(await api.admin.avaliacoes.listar()).some(a => a.id === minha.id));
});
