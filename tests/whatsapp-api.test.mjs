import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarHandler, dividirTexto, telefoneWhatsApp, assinaturaValida } from '../supabase/functions/whatsapp/index.ts';

const ID = '00000000-0000-4000-8000-000000000010', USER = '00000000-0000-4000-8000-000000000001', EVENTO = '00000000-0000-4000-8000-000000000020';
const NOW = Date.parse('2026-10-13T15:00:00Z'), TELEFONE = '5519992345678';
const ENV = { SUPABASE_URL: 'https://supabase.example', SUPABASE_SERVICE_ROLE_KEY: 'server-key', WHATSAPP_TOKEN: 'meta-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_GRAPH_VERSION: 'v25.0', WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_VERIFY_TOKEN: 'verify-secret', WHATSAPP_TEMPLATE: 'rita_atualizacao_pedido', WHATSAPP_AUTOMATION_SECRET: 'job-secret' };
async function assinar(corpo) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(ENV.WHATSAPP_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(corpo));
  return 'sha256=' + Buffer.from(bytes).toString('hex');
}
function ambiente({ aberta = true, autorizado = true, falharMeta = false, equipe = true, ativa = true } = {}) {
  const envios = [], partes = [], chamadasMeta = [], cfg = { whatsapp_api_ativa: ativa, url_site: 'https://loja.example/', whatsapp_numero: '551938451550' };
  const pedido = { id: ID, codigo: 'RB-123', token: 'token-recibo', whatsapp_autorizado: autorizado, cliente_nome: 'Maria Silva', cliente_telefone: TELEFONE,
    data_retirada: '2026-10-15', hora_retirada: '15:00', status: 'recebido', valor_sinal: 100, saldo: 100, itens: [{ nome: 'Kit completo', quantidade: 1,
      observacao: 'Sabor do bolo: Ninho\nFormato do bolo: Quadrado\nMassa do bolo: Preta\nSabores dos salgados fritos: Coxinha\nSabores dos pastéis: Queijo\nSabores dos docinhos: Brigadeiro\nTopo do bolo: Sim\nReferência: https://loja.example/topo.png' }] };
  const eventos = [{ id: EVENTO, pedido_id: ID, status: 'recebido', processado_em: null }];
  let ultima = aberta ? new Date(NOW - 10000).toISOString() : null;
  const responder = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const filtrar = (rows, u) => rows.filter(row => [...u.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(row[k]) === v.slice(3)));
  const fetchMock = async (endereco, opts = {}) => {
    const u = new URL(endereco), dados = opts.body ? JSON.parse(opts.body) : null;
    if (u.hostname === 'graph.facebook.com') {
      assert.equal(opts.headers.Authorization, 'Bearer meta-token');
      if (!dados) return responder({ display_phone_number: '+55 19 3845-1550', verified_name: 'Rita Bolos' });
      chamadasMeta.push(dados);
      if (falharMeta) throw new Error('Timeout simulado');
      return responder({ messages: [{ id: 'wamid.' + chamadasMeta.length }] });
    }
    assert.equal(u.hostname, 'supabase.example');
    if (u.pathname === '/auth/v1/user') return opts.headers.Authorization === 'Bearer user-token' ? responder({ id: USER }) : responder({}, 401);
    const tabela = u.pathname.replace('/rest/v1/', '');
    if (tabela === 'administradores') return responder(equipe ? [{ user_id: USER, papel: 'atendente' }] : []);
    if (tabela === 'configuracoes') return responder([cfg]);
    if (tabela === 'whatsapp_integracao') return responder([{ segredo: 'job-secret' }]);
    if (tabela === 'pedidos') return responder([pedido]);
    if (tabela === 'rpc/consultar_pedido') return responder({ ...pedido, cliente_telefone: null, token: null });
    if (tabela === 'rpc/recibo_pedido') return responder(pedido);
    if (tabela === 'pedido_entregas') return responder([]);
    if (tabela === 'status_pedido') return responder([{ codigo: eventos[0].status, nome: eventos[0].status }]);
    if (tabela === 'whatsapp_contatos') return responder(ultima ? [{ ultima_mensagem_em: ultima }] : []);
    if (tabela === 'rpc/whatsapp_recebido') { ultima = dados.p_quando; return responder(null); }
    if (tabela === 'rpc/whatsapp_status') {
      const parte = partes.find(p => p.meta_id === dados.p_meta_id);
      if (parte) parte.estado = dados.p_estado;
      return responder(null);
    }
    const rows = { whatsapp_envios: envios, whatsapp_partes: partes, whatsapp_automacoes: eventos }[tabela];
    assert.ok(rows, tabela);
    if (opts.method === 'POST') {
      if (tabela === 'whatsapp_envios' && rows.some(r => r.id === dados.id)) return responder({}, 409);
      const row = { estado: 'processando', ...dados }; rows.push(row); return responder([row]);
    }
    const resultado = filtrar(rows, u);
    if (opts.method === 'PATCH') resultado.forEach(r => Object.assign(r, dados));
    return responder(resultado);
  };
  const handler = criarHandler({ env: k => ENV[k], fetch: fetchMock, agora: () => NOW });
  async function chamar(dados, path = '', auth = 'user-token') {
    const r = await handler(new Request('https://edge.example/whatsapp' + path, { method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {}, body: JSON.stringify(dados) }));
    return { status: r.status, data: await r.json() };
  }
  const automatico = () => chamar({ evento_id: EVENTO }, '/automatico', 'job-secret');
  async function webhook(value, alterar = false) {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: ENV.WHATSAPP_PHONE_NUMBER_ID }, ...value } }] }] });
    return handler(new Request('https://edge.example/whatsapp/webhook', { method: 'POST', headers: { 'x-hub-signature-256': await assinar(body) }, body: alterar ? body + ' ' : body }));
  }
  return { handler, chamar, automatico, webhook, cfg, pedido, eventos, envios, partes, chamadasMeta };
}

test('aceita o fixo da empresa, normaliza celulares e divide texto sem perder caracteres', () => {
  assert.equal(telefoneWhatsApp('(19) 3845-1550'), '551938451550');
  assert.equal(telefoneWhatsApp('+55 (19) 99234-5678'), TELEFONE);
  assert.throws(() => telefoneWhatsApp('123'));
  const longo = ('🍰'.repeat(2001) + '\nSabor: Ninho\n').repeat(3);
  const partes = dividirTexto(longo);
  assert.equal(partes.join(''), longo);
  assert.ok(partes.every(p => p.length <= 4001 && !/[\uD800-\uDBFF]$/.test(p)));
  assert.throws(() => dividirTexto(' '));
});
test('rejeita chamadas anônimas, JWT inválido e usuário que não é da equipe', async () => {
  const a = ambiente();
  assert.equal((await a.chamar({ acao: 'conexao' }, '', null)).status, 401);
  assert.equal((await a.chamar({ acao: 'conexao' }, '', 'falso')).status, 401);
  assert.equal((await ambiente({ equipe: false }).chamar({ acao: 'conexao' })).status, 403);
  assert.equal((await a.chamar({ evento_id: EVENTO }, '/automatico', 'falso')).status, 401);
  assert.equal(a.chamadasMeta.length, 0);
});
test('verifica conexão do telefone fixo sem retornar segredos', async () => {
  const a = ambiente(), r = await a.chamar({ acao: 'conexao' });
  assert.equal(r.status, 200); assert.equal(r.data.pronta, true);
  for (const segredo of ['meta-token', 'server-key', 'job-secret', 'app-secret']) assert.ok(!JSON.stringify(r).includes(segredo));
});
test('automação envia todas as escolhas, restaura o telefone protegido e não duplica o evento', async () => {
  const a = ambiente(), r = await a.automatico();
  assert.equal(r.status, 200); assert.equal(r.data.estado, 'aceito');
  assert.equal(a.chamadasMeta.length, 1);
  const msg = a.chamadasMeta[0];
  assert.equal(msg.to, TELEFONE);
  for (const campo of ['Sabor do bolo', 'Formato do bolo', 'Massa do bolo', 'Sabores dos salgados fritos', 'Sabores dos pastéis', 'Sabores dos docinhos', 'Topo do bolo']) assert.ok(msg.text.body.includes(`*${campo}:*`), campo);
  assert.ok(msg.text.body.includes('https://loja.example/topo.png'));
  assert.equal((await a.automatico()).data.repetido, true);
  assert.equal(a.chamadasMeta.length, 1);
});
test('mudanças de status preservam o detalhamento e só vão ao cliente do pedido', async () => {
  for (const status of ['confirmado', 'em_producao', 'pronto', 'em_rota', 'retirado', 'cancelado']) {
    const a = ambiente(); a.eventos[0].status = status;
    assert.equal((await a.automatico()).status, 200);
    assert.equal(a.chamadasMeta[0].to, TELEFONE);
    assert.ok(a.chamadasMeta[0].text.body.includes('*Sabor do bolo:* Ninho'));
  }
});
test('fora da janela envia modelo aprovado e os detalhes seguem após resposta assinada', async () => {
  const a = ambiente({ aberta: false }), r = await a.automatico();
  assert.equal(r.data.estado, 'aguardando_resposta');
  assert.equal(a.chamadasMeta[0].type, 'template');
  assert.equal(a.chamadasMeta[0].template.name, ENV.WHATSAPP_TEMPLATE);
  assert.equal(a.chamadasMeta[0].template.components[0].parameters[2].text, 'https://loja.example/recibo.html?t=token-recibo');
  const evento = { messages: [{ id: 'inbound.1', from: TELEFONE, timestamp: String(NOW / 1000), type: 'text', text: { body: 'Pode enviar' } }] };
  assert.equal((await a.webhook(evento, true)).status, 401);
  assert.equal(a.chamadasMeta.length, 1);
  assert.equal((await a.webhook(evento)).status, 200);
  assert.equal(a.chamadasMeta[1].type, 'text');
  assert.ok(a.chamadasMeta[1].text.body.includes('*Sabor do bolo:* Ninho'));
  await a.webhook(evento);
  assert.equal(a.chamadasMeta.length, 2);
});
test('retirada de consentimento e integração desligada impedem envio automático', async () => {
  const a = ambiente({ autorizado: false });
  assert.equal((await a.automatico()).data.estado, 'cancelado'); assert.equal(a.chamadasMeta.length, 0);
  const b = ambiente({ ativa: false });
  assert.equal((await b.automatico()).status, 409); assert.equal(b.chamadasMeta.length, 0);
  const c = ambiente({ aberta: false }); await c.automatico(); c.pedido.whatsapp_autorizado = false;
  await c.webhook({ messages: [{ from: TELEFONE, timestamp: String(NOW / 1000), type: 'text' }] });
  assert.equal(c.chamadasMeta.length, 1);
});
test('timeout não é tratado como entrega nem causa repetição automática', async () => {
  const a = ambiente({ falharMeta: true });
  assert.equal((await a.automatico()).status, 504);
  assert.equal(a.envios[0].estado, 'incerto');
  assert.equal((await a.automatico()).data.estado, 'incerto');
  assert.equal(a.chamadasMeta.length, 1);
});
test('webhook verifica desafio, assinatura e estados sem enviar mensagem nova', async () => {
  const a = ambiente();
  const ok = await a.handler(new Request('https://edge.example/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=123'));
  assert.equal(await ok.text(), '123');
  assert.equal((await a.handler(new Request('https://edge.example/whatsapp/webhook?hub.verify_token=errado'))).status, 403);
  assert.equal(await assinaturaValida('{}', 'sha256=000', 'x'), false);
  await a.automatico();
  await a.webhook({ statuses: [{ id: 'wamid.1', status: 'delivered' }] });
  assert.equal(a.partes[0].estado, 'delivered'); assert.equal(a.chamadasMeta.length, 1);
});
test('envios concorrentes do mesmo evento reservam apenas uma mensagem', async () => {
  const a = ambiente();
  await Promise.all([a.automatico(), a.automatico()]);
  assert.equal(a.chamadasMeta.length, 1);
});
