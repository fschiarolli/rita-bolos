import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { criarApi, formatarPreco as R, formatarPeso, formatarData, separarReferencia, montarMensagemWhatsApp, agruparFinalizacoes, detalhesDoItem } from '../js/rita-api.js';
import { criarSupabaseDemo } from '../demo/supabase-demo.js';

const site = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const back = readFileSync(new URL('../backoffice/app.js', import.meta.url), 'utf8');
const recibo = readFileSync(new URL('../recibo.html', import.meta.url), 'utf8');
const trecho = (s, inicio, fim) => {
  const a = s.indexOf(inicio), b = s.indexOf(fim, a);
  assert.ok(a >= 0 && b > a, inicio);
  return s.slice(a, b);
};
const COLORIDO = 'finalizacao-colorida', GLITTER = 'finalizacao-glitter';
const opcoes = [
  { slug: COLORIDO, nome: 'Finalização colorida', rotulo: 'Colorido', preco: 15 },
  { slug: GLITTER, nome: 'Finalização com glitter', rotulo: 'Com glitter', preco: 15 }
];
function contexto() {
  const el = { value: '', textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {}, querySelector: () => ({}) };
  const ctx = vm.createContext({ FINALIZACOES: structuredClone(opcoes),
    ITEMS: { bolo: { id: 'bolo', name: 'Bolo de chocolate', price: 50, kind: 'cake' }, segundo: { price: 60, label: 'Ninho' } },
    cart: [], KIT_CAMPOS: [], WEIGHT_OPTIONS: [2], MASSAS: [{ v: 'branca', label: 'Massa branca' }], FORMATOS: [{ v: 'redondo', label: 'Redondo' }],
    sheetState: {}, CATALOG: {}, CFG: {}, saveCart() {}, cartChanged() {}, fmt: R, kg: formatarPeso, esc: s => String(s ?? ''),
    $: () => el, $$: () => [], sheetHead: () => '', thumbHTML: () => '', qtyStepper: () => '', formaSvg: () => '' });
  ctx.openSheet = html => { ctx.html = html; };
  vm.runInContext(trecho(site, 'const finDe =', '/* Topper (topo de bolo)'), ctx);
  vm.runInContext(trecho(site, 'function precoLinha(', 'function addSimple('), ctx);
  vm.runInContext(trecho(site, 'function addLine(', 'function cartChanged('), ctx);
  vm.runInContext(trecho(site, 'function cakeBase(', '/* ---- Imagem de referência do topper'), ctx);
  return ctx;
}
const linha = fin => ({ id: 'bolo', qty: 2, peso: 2, massa: 'branca', formato: 'redondo', fin, notes: '' });

test('colorido e glitter são caixas independentes; tradicional começa sem taxa', () => {
  const ctx = contexto(); ctx.openCake(ctx.ITEMS.bolo);
  assert.equal((ctx.html.match(/type="checkbox" name="fin"/g) || []).length, 2);
  assert.doesNotMatch(ctx.html, /type="radio" name="fin"/);
  assert.equal(ctx.cakeUnit(), 100);
  ctx.sheetState.fin = [COLORIDO, GLITTER];
  assert.equal(ctx.cakeUnit(), 130);
  ctx.sheetState.fin = [GLITTER];
  assert.equal(ctx.cakeUnit(), 115);
  ctx.sheetState.fin = [];
  assert.equal(ctx.cakeUnit(), 100);
});

test('sacola soma as opções por bolo e mantém o maior preço entre recheios', () => {
  const ctx = contexto(), l = linha([COLORIDO, GLITTER]);
  assert.equal(ctx.precoLinha(l), 130);
  ctx.cart.push(l);
  assert.equal(vm.runInContext('cartTotal()', ctx), 260);
  l.segundo = 'segundo';
  assert.equal(ctx.precoLinha(l), 150);
  assert.match(ctx.lineMeta(l), /colorido/);
  assert.match(ctx.lineMeta(l), /com glitter/);
});

test('sacolas antigas preservam a opção única; duplicadas e indisponíveis não são cobradas', () => {
  const ctx = contexto();
  ctx.cart = [linha(COLORIDO), linha([COLORIDO, COLORIDO, GLITTER, 'removida'])];
  ctx.syncCart();
  assert.deepEqual(Array.from(ctx.cart[0].fin), [COLORIDO]);
  assert.deepEqual(Array.from(ctx.cart[1].fin), [COLORIDO, GLITTER]);
  assert.equal(ctx.precoLinha(ctx.cart[0]), 115);
  assert.equal(ctx.precoLinha(ctx.cart[1]), 130);
  ctx.FINALIZACOES = [opcoes[1]];
  ctx.syncCart();
  assert.equal(ctx.precoLinha(ctx.cart[1]), 115);
});

test('ordem dos cliques não duplica linhas; combinações diferentes ficam separadas', () => {
  const ctx = contexto();
  ctx.addLine(linha([COLORIDO, GLITTER])); ctx.addLine(linha([GLITTER, COLORIDO]));
  assert.equal(ctx.cart.length, 1); assert.equal(ctx.cart[0].qty, 4);
  ctx.addLine(linha([COLORIDO]));
  assert.equal(ctx.cart.length, 2);
  ctx.addLine(linha(COLORIDO));
  assert.equal(ctx.cart.length, 2); assert.equal(ctx.cart[1].qty, 4);
});

test('backoffice oferece múltiplas opções e ignora seleções de finalização em produtos que não são bolos', () => {
  const ctx = vm.createContext({ esc: s => String(s ?? ''), R });
  vm.runInContext(trecho(back, 'const ehFinalizacao =', '/** Produtos do cardápio para montar itens'), ctx);
  const html = ctx.campoFinalizacoes('npFin1', opcoes);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2);
  const prods = { bolo: { tipo: 'bolo' }, doce: { tipo: 'simples' }, ...Object.fromEntries(opcoes.map(f => [f.slug, f])) };
  let produto = 'bolo', selecionadas = [COLORIDO, GLITTER];
  const box = { querySelector: () => ({ value: produto }), querySelectorAll: () => selecionadas.map(value => ({ value })) };
  assert.equal(ctx.finalizacoesMarcadas(box, prods).length, 2);
  selecionadas = [GLITTER]; assert.equal(ctx.finalizacoesMarcadas(box, prods).length, 1);
  produto = 'doce'; assert.equal(ctx.finalizacoesMarcadas(box, prods).length, 0);
});

test('pedido enviado salva ambas as finalizações na quantidade correta, no WhatsApp e nas impressões', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
  const api = criarApi(criarSupabaseDemo({ anonimo: true }));
  const catalogo = await api.cardapio.obter();
  const produtos = catalogo.categorias.flatMap(c => [...c.grupos.flatMap(g => g.produtos), ...c.produtos]);
  const bolo = produtos.find(p => p.tipo === 'bolo');
  const peso = Number(catalogo.bolo.pesos[0]);
  const ctx = contexto();
  ctx.ITEMS[bolo.slug] = { id: bolo.slug, name: bolo.nome, price: Number(bolo.preco), kind: 'cake' };
  ctx.cart = [{ ...linha([COLORIDO, GLITTER]), id: bolo.slug, peso, massa: catalogo.bolo.massas[0].slug, formato: catalogo.bolo.formatos[0].slug }];
  Object.assign(ctx, { API: api, U: null, NAME_KEY: '', PHONE_KEY: '', store() {}, validateCheckout: () => true, limparNome: v => v,
    formatarTel: v => v, conectarApi: async () => {}, comReferencia: v => v, observacaoLinha: () => '', referenciaLinha: () => null,
    console: { error: e => { throw e; } } });
  const inputs = { '#cName': 'Cliente Teste', '#cPhone': '19992345678', '#cDate': '2099-12-20', '#cTime': '15:00' };
  const original = ctx.$;
  ctx.$ = id => id in inputs ? { value: inputs[id] } : original(id);
  ctx.pedidoRegistrado = pedido => { ctx.salvo = pedido; };
  vm.runInContext(trecho(site, 'let enviando =', 'function pedidoRegistrado('), ctx);
  await ctx.sendOrder();
  assert.ok(ctx.salvo);
  const salvo = await api.pedidos.consultar(ctx.salvo.token);
  assert.equal(salvo.itens.length, 3);
  assert.deepEqual(salvo.itens.map(i => i.quantidade), [2, 2, 2]);
  assert.deepEqual(salvo.itens.slice(1).map(i => i.nome), opcoes.map(f => f.nome));
  assert.equal(salvo.total, Math.round((Number(bolo.preco) * peso + 30) * 2 * 100) / 100);
  assert.equal(salvo.total, ctx.precoLinha(ctx.cart[0]) * 2);
  const print = vm.createContext({ R, formatarPeso, formatarData, separarReferencia, agruparFinalizacoes, detalhesDoItem, esc: s => String(s ?? ''),
    dataHora: () => '', dataCurta: s => s, hora: s => s, ORIGENS: {}, kitDoItem: () => null, conteudoKit: () => null,
    area: { innerHTML: '' }, document: { getElementById: () => ({}) } });
  vm.runInContext(trecho(back, 'function cupomTermica(', '/** Um ou mais pedidos completos'), print);
  vm.runInContext(trecho(recibo, 'function render(', 'function configurarBarra('), print);
  print.render(salvo, { interno: false, pix: null });
  for (const resultado of [montarMensagemWhatsApp(salvo), print.cupomTermica(salvo, {}, null), print.area.innerHTML]) {
    for (const f of opcoes) assert.ok(resultado.includes(f.nome), f.nome);
  }
});
