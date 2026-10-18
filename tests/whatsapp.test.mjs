import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { detalhesItemWhatsApp, itensWhatsApp, montarMensagemWhatsApp, montarMensagemStatus,
  juntarReferencia, formatarPreco, formatarPeso, formatarData, formatarCep, textoEndereco, quemRecebe, textoPix, localRetirada, linhasLocalRetirada } from '../js/rita-api.js';

const escolhas = {
  'Sabor do bolo': 'Ninho com morango',
  'Formato do bolo': 'Quadrado',
  'Massa do bolo': 'Preta',
  'Sabores dos salgados fritos': '20 coxinhas\n10 quibes',
  'Sabores dos pastéis': '10 carne e 10 queijo',
  'Sabores dos docinhos': '15 brigadeiros\n15 beijinhos',
  'Topo do bolo': 'Sim'
};
const referencia = 'https://example.com/topo.png';
const notas = 'Escrever: Ana & João\nIdade: 5 anos';
const observacao = juntarReferencia([...Object.entries(escolhas).map(([rotulo, valor]) => `${rotulo}: ${valor}`), notas].join('\n'), referencia);
const kit = () => ({ nome: 'Kit completo', quantidade: 2, preco_unitario: 200, subtotal: 400, observacao });
const pedido = () => ({ codigo: 'RB-TESTE', cliente_nome: 'Maria Silva', cliente_telefone: '11999990000', status: 'recebido',
  data_retirada: '2099-12-20', hora_retirada: '15:00', total: 400, valor_sinal: 200, valor_pago: 100, saldo: 300,
  itens: [kit()], observacao_cliente: 'Vou buscar com minha irmã.' });
const back = readFileSync(new URL('../backoffice/app.js', import.meta.url), 'utf8');
const site = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function trecho(fonte, inicio, fim) {
  const a = fonte.indexOf(inicio), b = fonte.indexOf(fim, a);
  assert.ok(a >= 0 && b > a);
  return fonte.slice(a, b);
}
function conferirKit(txt) {
  for (const [rotulo, valor] of Object.entries(escolhas)) assert.ok(txt.includes(`*${rotulo}:* ${valor}`), rotulo);
  assert.ok(txt.includes(`_Obs:_ ${notas}`));
  assert.ok(txt.includes(`_Imagem de referência:_ ${referencia}`));
  assert.ok(!txt.includes('_Obs:_ Sabor do bolo:'));
}
function modelos(p = pedido(), recibo = 'https://example.com/recibo.html?t=teste', cfg = null) {
  const ctx = vm.createContext({ R: formatarPreco, formatarData, formatarPeso, itensWhatsApp, textoEndereco, quemRecebe,
    formatarCep, textoPix, linhasLocalRetirada, hora: x => x.slice(0, 5), hojeISO: () => '2099-12-20', statusDe: () => ({ finalizado: false }) });
  vm.runInContext(trecho(back, 'function modelosMensagem(', 'async function modalMensagem('), ctx);
  return ctx.modelosMensagem(p, recibo, null, cfg).modelos;
}

test('mensagem do pedido salvo separa todos os campos do kit, notas e referência', () => {
  conferirKit(montarMensagemWhatsApp(pedido()));
});

test('kit parcial sem topo mostra só as informações preenchidas', () => {
  const txt = detalhesItemWhatsApp({ observacao: 'Sabores dos pastéis: Queijo\nCarne\nTopo do bolo: Não' });
  assert.equal(txt, '*Sabores dos pastéis:* Queijo\nCarne\n*Topo do bolo:* Não');
  assert.doesNotMatch(txt, /Formato|Massa|Sabor do bolo|docinhos|referência/i);
});

test('kits diferentes mantêm as escolhas e referências vinculadas a cada item', () => {
  const outro = { ...kit(), nome: 'Kit pequeno', quantidade: 1,
    observacao: 'Sabor do bolo: Chocolate\nFormato do bolo: Redondo\nMassa do bolo: Branca\nTopo do bolo: Não' };
  const txt = itensWhatsApp([kit(), outro]);
  const [primeiro, segundo] = txt.split('\n\n• 1× Kit pequeno\n');
  assert.match(primeiro, /^• 2× Kit completo/);
  conferirKit(primeiro);
  assert.match(segundo, /\*Sabor do bolo:\* Chocolate/);
  assert.match(segundo, /\*Formato do bolo:\* Redondo/);
  assert.match(segundo, /\*Massa do bolo:\* Branca/);
  assert.doesNotMatch(segundo, /morango|coxinhas|topo.png/);
});

test('observações antigas e detalhes dos bolos avulsos continuam completos', () => {
  assert.equal(detalhesItemWhatsApp({ observacao: 'Sem amendoim\nEntregar na portaria' }), '_Obs:_ Sem amendoim\nEntregar na portaria');
  assert.equal(detalhesItemWhatsApp({ massa: 'Branca', formato: 'Redondo', segundo_recheio: 'Chocolate', observacao: 'Pouco açúcar' }),
    '_Massa:_ Branca\n_Formato:_ Redondo\n_2º recheio:_ Chocolate\n_Obs:_ Pouco açúcar');
  const txt = detalhesItemWhatsApp({ observacao: juntarReferencia('Topo do bolo: Sim\nSabor do bolo: confirmar na retirada', 'data:image/png;base64,AAA') });
  assert.match(txt, /_Obs:_ Sabor do bolo: confirmar na retirada/);
  assert.match(txt, /\(imagem anexada no pedido\)/);
  assert.doesNotMatch(txt, /data:image/);
  assert.equal(detalhesItemWhatsApp({}), '');
});

test('modelos de dados, recibo e lembrete ao cliente incluem as escolhas dos kits', () => {
  for (const entrega of [null, { endereco: 'Rua das Flores, 10', cidade: 'Campinas - SP' }]) {
    const p = { ...pedido(), entrega }, lista = modelos(p);
    for (const id of ['pedido', 'recibo', 'retirada']) conferirKit(lista.find(m => m.id === id).txt);
    for (const id of ['pedido', 'recibo']) {
      const txt = lista.find(m => m.id === id).txt;
      assert.ok(txt.includes(p.observacao_cliente));
      assert.ok(txt.includes('*Total:* R$ 400,00'));
      assert.ok(txt.includes('*Pago:* R$ 100,00'));
      assert.ok(txt.includes('*Saldo a pagar:* R$ 300,00'));
      assert.ok(txt.includes('https://example.com/recibo.html?t=teste'));
      if (entrega) assert.ok(txt.includes(entrega.endereco));
    }
  }
  conferirKit(modelos(pedido(), '').find(m => m.id === 'pedido').txt);
});

test('recebimento e confirmação detalham o pedido; aviso de presente preserva o destinatário', () => {
  for (const codigo of ['recebido', 'confirmado']) {
    const txt = montarMensagemStatus(pedido(), { codigo });
    conferirKit(txt);
    assert.ok(txt.includes(pedido().observacao_cliente));
  }
  const p = { ...pedido(), entrega: { recebedor_nome: 'Ana', recebedor_telefone: '11999991111', endereco: 'Rua A, 10' } };
  const txt = montarMensagemStatus(p, { codigo: 'em_rota' }, 'https://example.com/recibo');
  assert.match(txt, /Ana/);
  assert.doesNotMatch(txt, /R\$|recibo|Kit completo|Ninho/);
});

test('mensagens com vários kits preservam o texto completo acima de 2.000 caracteres', () => {
  const p = { ...pedido(), itens: Array.from({ length: 8 }, (_, i) => ({ ...kit(), nome: `Kit ${i + 1}` })) };
  const txt = modelos(p).find(m => m.id === 'pedido').txt;
  assert.ok(txt.length > 2000);
  assert.equal(txt.split('*Sabor do bolo:*').length - 1, 8);
  assert.ok(txt.includes('Kit 8'));
  assert.doesNotMatch(trecho(back, 'async function modalMensagem(', 'async function modalStatus('), /maxlength=/);
  assert.doesNotMatch(trecho(back, 'async function campoAvisoWa(', 'function ligarAvisoWa('), /maxlength=/);
});

test('envio direto do cardápio também separa os campos do kit', () => {
  let enviada;
  const ctx = vm.createContext({ validateCheckout: () => true, limparNome: x => x, $: () => ({ value: 'teste' }),
    CFG: {}, U: { detalhesItemWhatsApp }, cartTotal: () => 400, formatPickupDate: () => '20/12/2099',
    cart: [{ id: 'kit', qty: 2 }], ITEMS: { kit: { name: 'Kit completo', isKit: true } },
    precoLinha: () => 200, lineMeta: () => '', fmt: formatarPreco, observacaoLinha: () => observacao,
    referenciaLinha: () => null, comReferencia: juntarReferencia, pctTxt: () => '50', sinalDe: () => 200,
    pix: () => null, waLink: (_, msg) => msg, abrirWa: msg => { enviada = msg; } });
  vm.runInContext(trecho(site, 'function sendDirect(', 'function openClearConfirm('), ctx);
  ctx.sendDirect();
  conferirKit(enviada);
});

test('confirmação e pedido pronto dizem onde retirar, com o link do mapa', () => {
  const cfg = { endereco_retirada: 'Rua Jesus Tomás de Aquino, 44 - Jardim Santo André, Hortolândia', entrega_origem: '-22.8815, -47.2059' };
  const mapa = 'https://www.google.com/maps/search/?api=1&query=Rua%20Jesus%20Tom%C3%A1s%20de%20Aquino%2C%2044%20-%20Jardim%20Santo%20Andr%C3%A9%2C%20Hortol%C3%A2ndia';
  for (const codigo of ['confirmado', 'pronto']) {
    const txt = montarMensagemStatus(pedido(), { codigo }, null, cfg);
    assert.ok(txt.includes(`*Local de retirada:* ${cfg.endereco_retirada}\nMapa: ${mapa}`), codigo);
  }
  for (const codigo of ['recebido', 'em_producao']) assert.doesNotMatch(montarMensagemStatus(pedido(), { codigo }, null, cfg), /Local de retirada/);
  // entrega: vai o endereço do cliente, não o da loja
  const entrega = { ...pedido(), entrega: { endereco: 'Rua A, 10', cidade: 'Campinas' } };
  assert.doesNotMatch(montarMensagemStatus(entrega, { codigo: 'confirmado' }, null, cfg), /Local de retirada/);
  // os modelos do backoffice: lembrete da retirada e pedido pronto
  const lista = modelos(pedido(), '', cfg);
  for (const id of ['retirada', 'pronto']) assert.ok(lista.find(m => m.id === id).txt.includes(`*Local de retirada:* ${cfg.endereco_retirada}`), id);
});

test('sem endereço de retirada vale o da entrega; coordenadas viram só o link', () => {
  assert.equal(localRetirada({}), null);
  assert.deepEqual(localRetirada({ entrega_origem: '-22.88150483513304, -47.20591178835479' }),
    { texto: '', mapa: 'https://www.google.com/maps/search/?api=1&query=-22.88150483513304,-47.20591178835479' });
  assert.deepEqual(localRetirada({ entrega_origem: 'Rua das Flores, 123, Centro', entrega_origem_lat: -22.9, entrega_origem_lng: -47.1 }),
    { texto: 'Rua das Flores, 123, Centro', mapa: 'https://www.google.com/maps/search/?api=1&query=-22.9,-47.1' });
  assert.deepEqual(linhasLocalRetirada({ entrega_origem: '-22.8815, -47.2059' }), ['*Local de retirada:* https://www.google.com/maps/search/?api=1&query=-22.8815,-47.2059']);
  assert.doesNotMatch(montarMensagemStatus(pedido(), { codigo: 'confirmado' }, null, null), /Local de retirada/);
});
