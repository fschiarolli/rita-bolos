import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { DADOS_DEMO } from '../demo/dados-demo.js';
import { criarSupabaseDemo } from '../demo/supabase-demo.js';
import { criarApi, juntarReferencia, separarReferencia, montarMensagemWhatsApp, formatarPreco, formatarPeso, formatarData } from '../js/rita-api.js';

const fonte = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const backoffice = readFileSync(new URL('../backoffice/app.js', import.meta.url), 'utf8');
const recibo = readFileSync(new URL('../recibo.html', import.meta.url), 'utf8');
const trecho = (s, inicio, fim) => {
  assert.ok(s.includes(inicio) && s.includes(fim), `Trecho não encontrado: ${inicio}`);
  return s.slice(s.indexOf(inicio), s.indexOf(fim, s.indexOf(inicio)));
};
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function contexto() {
  const ITEMS = Object.fromEntries(DADOS_DEMO.produtos.filter(p => p.unidade_preco === 'kit').map(p =>
    [p.slug, { id: p.slug, name: p.nome, desc: p.descricao, isKit: true }]));
  ITEMS.completo = { id: 'completo', name: 'Kit completo', desc: 'Bolo, salgados fritos, pastéis e docinhos.', isKit: true };
  const ctx = vm.createContext({ ITEMS, norm: s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    cart: [], FINALIZACOES: [], cartChanged() {}, esc });
  vm.runInContext(trecho(fonte, 'const finDe =', '/* Topper (topo de bolo)'), ctx);
  vm.runInContext(trecho(fonte, 'const ehTopperItem =', 'const CAT_ALIAS ='), ctx);
  vm.runInContext(trecho(fonte, 'function addLine(', 'function cartChanged('), ctx);
  vm.runInContext(trecho(fonte, 'function camposKitHTML(', 'function lerEscolhasKit('), ctx);
  return ctx;
}
const completo = () => ({ id: 'completo', qty: 1, notes: 'Tema: jardim', kit: {
  bolo: 'Ninho com morango', formato: 'Quadrado', massa: 'Preta',
  salgados: '20 coxinhas e 10 quibes', pasteis: '10 carne e 10 queijo', docinhos: '15 brigadeiros e 15 beijinhos'
} });

test('campos obrigatórios seguem a composição de cada kit', () => {
  const ctx = contexto();
  const campos = id => Array.from(ctx.camposKit(ctx.ITEMS[id]), c => c.key);
  assert.deepEqual(campos('kit-1kg-bolo-topper'), ['bolo', 'formato', 'massa']);
  assert.deepEqual(campos('kit-1kg-bolo-30-salgados'), ['bolo', 'formato', 'massa', 'salgados']);
  assert.deepEqual(campos('kit-festa-10-pessoas'), ['bolo', 'formato', 'massa', 'salgados', 'docinhos']);
  assert.deepEqual(campos('completo'), ['bolo', 'formato', 'massa', 'salgados', 'pasteis', 'docinhos']);
  assert.deepEqual(Array.from(ctx.camposKit({ name: 'Kit pastéis', desc: '20 pastéis' }), c => c.key), ['pasteis']);
  assert.deepEqual(Array.from(ctx.camposKit({ name: 'Kit pastéis fritos', desc: '20 pastéis fritos' }), c => c.key), ['pasteis']);
  assert.deepEqual(Array.from(ctx.camposKit({ name: 'Kit bebidas', desc: 'Refrigerantes e sucos' }), c => c.key), []);
});

test('nenhuma escolha vem preenchida e todos os campos têm rótulo e obrigatoriedade', () => {
  const ctx = contexto(), html = ctx.camposKitHTML(ctx.ITEMS.completo);
  assert.equal((html.match(/ required /g) || []).length, 6);
  assert.equal((html.match(/<label /g) || []).length, 6);
  assert.doesNotMatch(html, /kit-topo/);
  assert.doesNotMatch(html, / selected/);
  const editado = ctx.camposKitHTML(ctx.ITEMS.completo, { ...completo().kit, bolo: '</textarea><img src=x>' });
  assert.match(editado, /value="Quadrado" selected/);
  assert.match(editado, /&lt;\/textarea&gt;&lt;img src=x&gt;/);
});

test('sabores, formato e massa são obrigatórios; notas livres não substituem escolhas', () => {
  const ctx = contexto();
  assert.equal(ctx.kitIncompleto(completo()), false);
  for (const key of Object.keys(completo().kit)) {
    const linha = completo(); linha.kit[key] = '   ';
    assert.equal(ctx.kitIncompleto(linha), true, key);
  }
  for (const [key, valor] of [['formato', 'Triangular'], ['massa', 'Outra']]) {
    const linha = completo(); linha.kit[key] = valor;
    assert.equal(ctx.kitIncompleto(linha), true, key);
  }
  assert.equal(ctx.kitIncompleto({ id: 'completo', notes: 'Já preenchi as observações' }), true);
});

test('kits com topo no nome ou na descrição exigem referência, mesmo com antiga escolha Não', () => {
  const ctx = contexto();
  for (const id of ['kit-1kg-bolo-topper', 'kit-30-pessoas']) {
    const linha = { ...completo(), id }; linha.kit.topo = 'Não';
    assert.equal(ctx.kitIncompleto(linha), true, id);
    linha.ref = 'https://example.com/topo.png';
    assert.equal(ctx.kitIncompleto(linha), false, id);
    assert.ok(ctx.escolhasKit(linha).includes('Topo do bolo: Sim'));
    linha.refEnviando = true;
    assert.equal(ctx.kitIncompleto(linha), true, id);
  }
});

test('kits sem topo não exigem referência e descartam a antiga escolha Sim', () => {
  const ctx = contexto(), linha = completo();
  assert.equal(ctx.kitIncompleto(linha), false);
  linha.kit.topo = 'Sim'; linha.ref = 'https://example.com/antiga.png';
  assert.equal(ctx.kitIncompleto(linha), false);
  assert.ok(ctx.escolhasKit(linha).includes('Topo do bolo: Não'));
  ctx.linha = linha;
  assert.equal(vm.runInContext('referenciaLinha(linha)', ctx), null);
});

test('formulário mostra envio obrigatório apenas nos kits que incluem topo', () => {
  const ctx = contexto();
  Object.assign(ctx, { sheetState: {}, KITS_CAT: null, fmt: () => '', thumbHTML: () => '', sheetHead: () => '',
    refBoxHTML: () => '', qtyStepper: () => '', $: () => ({ textContent: '' }), openSheet: html => { ctx.html = html; } });
  vm.runInContext(trecho(fonte, 'function openConfig(', '/* ---- Quantidade com mínimo'), ctx);
  for (const id of ['kit-1kg-bolo-topper', 'kit-30-pessoas']) {
    ctx.openConfig(ctx.ITEMS[id]);
    assert.match(ctx.html, /id="refField"><span class="lbl">Imagem de referência/);
    assert.match(ctx.html, /Este kit inclui topo/);
    assert.doesNotMatch(ctx.html, /kit-topo/);
  }
  ctx.openConfig(ctx.ITEMS['kit-festa-10-pessoas']);
  assert.doesNotMatch(ctx.html, /refField|cfgRef|kit-topo|nome e idade para o topo/);
});

test('kits iguais somam quantidades; escolhas diferentes preservam linhas separadas', () => {
  const ctx = contexto();
  ctx.addLine(completo()); ctx.addLine(completo());
  assert.equal(ctx.cart.length, 1); assert.equal(ctx.cart[0].qty, 2);
  const outro = completo(); outro.kit.pasteis = 'Somente queijo'; ctx.addLine(outro);
  assert.equal(ctx.cart.length, 2); assert.equal(ctx.cart[1].qty, 1);
});

test('pedido salvo e consultado mantém todas as escolhas e referência no WhatsApp e nas impressões', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
  const ctx = contexto(), linha = completo();
  ctx.ITEMS.completo.desc += ' Topo personalizado.';
  linha.ref = 'https://example.com/referencia.png';
  linha.notes = 'Escrever: <Ana & João>\nIdade: 5 anos';
  ctx.linha = linha;
  const obs = juntarReferencia(vm.runInContext('observacaoLinha(linha)', ctx), linha.ref);
  const api = criarApi(criarSupabaseDemo({ anonimo: true }));
  const pedido = await api.pedidos.criar({ cliente_nome: 'Cliente de Teste', data_retirada: '2099-12-20', hora_retirada: '15:00',
    itens: [{ produto_slug: 'kit-30-pessoas', quantidade: 1, observacao: obs }] });
  const salvo = await api.pedidos.consultar(pedido.token);
  assert.equal(salvo.itens[0].observacao, obs);
  const texto = separarReferencia(obs).texto;
  assert.ok(texto.includes('Topo do bolo: Sim'));
  for (const valor of Object.values(linha.kit)) assert.ok(texto.includes(valor), valor);
  assert.ok(montarMensagemWhatsApp(salvo).includes(texto));
  assert.ok(montarMensagemWhatsApp(salvo).includes(linha.ref));

  const impressao = vm.createContext({ esc, separarReferencia, kitDoItem: () => 'Bolo, salgados, pastéis e docinhos',
    R: formatarPreco, formatarPeso, formatarData, formatarTel: s => s, dataHora: s => s, dataCurta: s => s,
    hora: s => s, ORIGENS: {}, area: { innerHTML: '' }, document: { title: '', getElementById: () => ({}) },
    conteudoKit: () => 'Bolo, salgados, pastéis e docinhos' });
  vm.runInContext(trecho(backoffice, 'function cupomTermica(', '/** Um ou mais pedidos completos'), impressao);
  const termica = impressao.cupomTermica(salvo, {}, null);
  vm.runInContext(trecho(recibo, 'function render(', 'function configurarBarra('), impressao);
  impressao.render(salvo, { interno: false, mostrarInterno: false, pix: null });
  for (const html of [termica, impressao.area.innerHTML]) {
    for (const valor of Object.values(linha.kit)) assert.ok(html.includes(valor), valor);
    assert.ok(html.includes(esc(linha.notes)));
    assert.ok(html.includes(`src="${linha.ref}"`));
    assert.ok(!html.includes('<Ana & João>'));
  }
  assert.match(backoffice, /\.it \.ob \{ white-space: pre-line; overflow-wrap: anywhere;/);
  assert.match(recibo, /\.det\.obs \{ white-space: pre-line; overflow-wrap: anywhere;/);
  assert.doesNotMatch(recibo, /body\.cupom \.det\.ref img \{ display: none/);
});
