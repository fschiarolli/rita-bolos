import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarSupabaseDemo } from '../demo/supabase-demo.js';
import { criarApi, linkRecibo, linkAcompanhar, montarMensagemStatus, montarMensagemWhatsApp } from '../js/rita-api.js';

// Acompanhamento do pedido (acompanhar.html) e cartão fidelidade (sql/fidelidade.sql), na demonstração que imita o banco
// (o mesmo SQL foi testado num Postgres de verdade antes de ir para sql/).

test('as mensagens levam o link de acompanhar o pedido', () => {
  const url = linkRecibo('abc-123', 'https://www.ritabolos.com');
  assert.equal(linkAcompanhar(url), 'https://www.ritabolos.com/acompanhar.html?t=abc-123');
  assert.equal(linkAcompanhar('recibo.html?t=x&demo'), 'acompanhar.html?t=x&demo');
  const p = { codigo: 'RB-01042', cliente_nome: 'Maria Souza', data_retirada: '2026-10-19', hora_retirada: '10:00', total: 100, valor_sinal: 50, percentual_sinal: 50, saldo: 0, itens: [] };
  assert.ok(montarMensagemWhatsApp(p, url, {}).includes('https://www.ritabolos.com/acompanhar.html?t=abc-123'));
  assert.ok(montarMensagemStatus(p, { codigo: 'em_producao' }, url, {}).includes('Acompanhe o pedido: https://www.ritabolos.com/acompanhar.html?t=abc-123'));
});

test('a cada R$ 100 uma estrela; com 5, o prêmio; resgatar zera o cartão', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
  const api = criarApi(criarSupabaseDemo({}));
  await api.auth.entrar('rita@demo.com.br', 'demo');
  const novo = async (telefone, kg) => {
    const p = await api.admin.pedidos.criar({ cliente_nome: 'Joana Prado', cliente_telefone: telefone, data_retirada: '2026-10-20', hora_retirada: '10:00',
      itens: [{ produto_slug: 'bolo-brigadeiro', quantidade: 1, peso_kg: kg, massa: 'branca', formato: 'redondo' }] });
    return { ...p, token: (await api.admin.pedidos.obter(p.id)).token };
  };

  // começa desligado: a página do cliente não mostra o cartão
  const primeiro = await novo('(19) 99700-1122', 2);
  assert.equal((await api.fidelidade.doPedido(primeiro.token)).ativa, false);
  await api.admin.configuracoes.salvar({ fidelidade_ativa: true, fidelidade_valor: 100, fidelidade_estrelas: 5, fidelidade_premio: 'Um bolo de 1 kg', fidelidade_desde: '2026-10-01' });

  // as etapas na ordem, com a hora de quando o pedido entrou em cada uma
  let e = await api.pedidos.etapas(primeiro.token);
  assert.equal(e.status, 'recebido');
  assert.ok(e.etapas[0].codigo === 'recebido' && e.etapas[0].quando, 'recebido com a hora do pedido');
  assert.ok(e.etapas.every(x => x.nome && 'descricao' in x), 'cada etapa com nome e descrição');

  // pedido em aberto ainda não conta; retirado conta
  let c = await api.fidelidade.doPedido(primeiro.token);
  assert.equal(c.estrelas, 0); assert.equal(c.este_pedido.contou, false);
  await api.admin.pedidos.alterarStatus(primeiro.id, 'retirado');
  e = await api.pedidos.etapas(primeiro.token);
  assert.ok(e.etapas.find(x => x.codigo === 'retirado').quando, 'retirado com a hora da mudança');
  c = await api.fidelidade.doPedido(primeiro.token);
  assert.equal(Number(c.gasto), Number(primeiro.total)); assert.equal(c.este_pedido.contou, true);
  assert.equal(c.estrelas, Math.floor(primeiro.total / 100)); assert.ok(!('telefone' in c), 'a página do cliente não recebe o telefone');

  // o mesmo cliente com o telefone escrito de outro jeito, até passar de R$ 500
  while ((await api.admin.fidelidade.cartao('19997001122')).gasto < 500) {
    const p = await novo('+55 19 99700 1122', 3); await api.admin.pedidos.alterarStatus(p.id, 'retirado');
  }
  c = await api.admin.fidelidade.cartao('19 99700-1122');
  assert.equal(c.estrelas, Math.floor(c.gasto / 100)); assert.ok(c.premios >= 1);
  assert.equal(Number(c.falta), Math.round((100 - (c.gasto % 100)) * 100) / 100);
  const lista = await api.admin.fidelidade.clientes();
  assert.equal(lista[0].telefone, '19997001122'); assert.equal(lista[0].premios, c.premios);

  // resgatar: as 5 estrelas saem e o histórico guarda o prêmio
  const antes = c.estrelas;
  c = await api.admin.fidelidade.resgatar('(19) 99700-1122', { observacao: 'levou no sábado' });
  assert.equal(c.estrelas, antes - 5); assert.equal(c.historico[0].premio, 'Um bolo de 1 kg'); assert.equal(c.historico[0].observacao, 'levou no sábado');
  if (c.estrelas < 5) await assert.rejects(api.admin.fidelidade.resgatar('19997001122'), /Ainda faltam/);

  // a Administração desfaz: as estrelas voltam
  await api.admin.fidelidade.desfazer(c.historico[0].id);
  assert.equal((await api.admin.fidelidade.cartao('19997001122')).estrelas, antes);
});
