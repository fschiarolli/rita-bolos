import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { criarApi, formatarPreco as R, formatarPeso } from '../js/rita-api.js';
import { criarSupabaseDemo } from '../demo/supabase-demo.js';

// Pedido mínimo em kg (sql/peso-minimo.sql): o bolo salgado é pedido a partir de 2,5 kg, escolhendo o peso.
const site = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const trecho = (s, inicio, fim) => {
  const a = s.indexOf(inicio), b = s.indexOf(fim, a);
  assert.ok(a >= 0 && b > a, inicio);
  return s.slice(a, b);
};
const produtosDe = c => c.categorias.flatMap(cat => [...cat.grupos.flatMap(g => g.produtos), ...cat.produtos]);

function contexto() {
  const el = { value: '', textContent: '', disabled: false, innerHTML: '', setAttribute() {}, removeAttribute() {}, querySelector: () => ({ textContent: '' }) };
  const ctx = vm.createContext({ ITEMS: {}, cart: [], KIT_CAMPOS: [], WEIGHT_OPTIONS: [1.5], MASSAS: [], FORMATOS: [], FINALIZACOES: [], sheetState: {}, CFG: {},
    TONE_POR_ICONE: {}, imgUrl: () => null, artePara: () => '', saveCart() {}, cartChanged() {}, fmt: R, kg: formatarPeso, esc: s => String(s ?? ''),
    $: () => el, $$: () => [], sheetHead: () => '', thumbHTML: () => '', qtyStepper: () => '', refBoxHTML: () => '', KITS_CAT: null, precisaReferencia: () => false,
    camposKitHTML: () => '', icon: () => '' });
  ctx.openSheet = html => { ctx.html = html; };
  vm.runInContext(trecho(site, 'const finDe =', '/* Topper (topo de bolo)'), ctx);
  vm.runInContext(trecho(site, 'function quantidadeMinima(', 'function buildCatalog('), ctx);
  vm.runInContext(trecho(site, 'function precoLinha(', 'function addSimple('), ctx);
  vm.runInContext(trecho(site, 'function openConfig(', '/* ---- Quantidade com mínimo'), ctx);
  return ctx;
}

test('bolo salgado: mínimo de 2,5 kg no cardápio, folha começa no mínimo e o preço segue o peso', async () => {
  const api = criarApi(criarSupabaseDemo({ anonimo: true }));
  const produtos = produtosDe(await api.cardapio.obter());
  const bs = produtos.find(p => p.slug === 'salgado-bolo-salgado');
  assert.equal(Number(bs.peso_minimo_kg), 2.5);
  assert.equal(bs.nome, 'Bolo salgado');

  const ctx = contexto(), cat = { slug: 'salgados', nome: 'Salgados', layout: 'lista' };
  const it = ctx.ITEMS[bs.slug] = ctx.itemDe(bs, cat, {});
  assert.equal(it.pesoMin, 2.5);
  assert.equal(it.kind, 'config');
  const semMinimo = ctx.itemDe({ ...bs, peso_minimo_kg: null, tipo: 'simples' }, cat, {});
  assert.equal(semMinimo.pesoMin, 0);
  assert.equal(semMinimo.kind, 'simple');

  ctx.openConfig(it);
  assert.equal(ctx.sheetState.peso, 2.5);
  assert.match(ctx.html, /data-peso="0.5"/);
  assert.match(ctx.html, /Pedido mínimo de 2,5 kg/);
  ctx.s = { ...ctx.sheetState, peso: 3, qty: 2 };
  assert.equal(vm.runInContext('precoCfg(s)', ctx), 450);
  assert.equal(ctx.precoLinha({ id: bs.slug, qty: 1, peso: 3 }), 225);
  assert.equal(ctx.precoLinha({ id: bs.slug, qty: 1, peso: 1 }), 187.5, 'abaixo do mínimo vale o mínimo');
});

test('o pedido grava o peso e recusa abaixo do mínimo', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
  const api = criarApi(criarSupabaseDemo({ anonimo: true }));
  const pedir = peso_kg => api.pedidos.criar({ cliente_nome: 'Cliente Teste', data_retirada: '2099-12-20', hora_retirada: '15:00',
    itens: [{ produto_slug: 'salgado-bolo-salgado', quantidade: 2, peso_kg }] });
  const salvo = await api.pedidos.consultar((await pedir(3)).token);
  assert.equal(Number(salvo.itens[0].peso_kg), 3);
  assert.equal(Number(salvo.itens[0].preco_unitario), 225);
  assert.equal(Number(salvo.total), 450);
  await assert.rejects(pedir(2), /pedido mínimo de "Bolo salgado" é de 2,5 kg/);
  await assert.rejects(pedir(undefined), /Escolha o peso/);
});
