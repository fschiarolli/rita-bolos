import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { DADOS_DEMO } from '../demo/dados-demo.js';
import { mapaKits, conteudoKit, separarReferencia, formatarPeso } from '../js/rita-api.js';

const backoffice = readFileSync(new URL('../backoffice/app.js', import.meta.url), 'utf8');
const trecho = (s, inicio, fim) => {
  assert.ok(s.includes(inicio) && s.includes(fim), `Trecho não encontrado: ${inicio}`);
  return s.slice(s.indexOf(inicio), s.indexOf(fim, s.indexOf(inicio)));
};
const js = v => JSON.parse(JSON.stringify(v));   // objetos do vm têm outro protótipo
const ctx = vm.createContext({ mapaKits, conteudoKit, separarReferencia, formatarPeso,
  semAcento: s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() });
vm.runInContext(trecho(backoffice, 'const partesDoKit =', 'async function telaProducao(').replace(/^const /gm, 'var '), ctx);

const D = DADOS_DEMO;
const produtos = D.produtos.map(p => ({ ...p, grupo_nome: D.grupos.find(g => g.id === p.grupo_id)?.nome ?? null,
  categoria_nome: D.categorias.find(c => c.id === p.categoria_id)?.nome }));
const prod = slug => produtos.find(p => p.slug === slug);
const item = (slug, quantidade, observacao = null) => ({ produto_id: prod(slug).id, nome: prod(slug).nome, categoria: prod(slug).categoria_nome, quantidade, observacao });
const pedido = (id, ...itens) => ({ id, data_retirada: '2026-10-17', itens });

test('partesDoKit lê as quantidades da descrição do kit, sem o peso do bolo', () => {
  assert.deepEqual(js(ctx.partesDoKit('1,5 kg de bolo, 120 salgados, 20 docinhos e 2 refrigerantes 2 L.')),
    [{ qtd: 120, nome: 'salgados' }, { qtd: 20, nome: 'docinhos' }, { qtd: 2, nome: 'refrigerantes' }]);
  assert.deepEqual(js(ctx.partesDoKit('Bolo de 1 kg com topper personalizado.')), []);
});

test('cento e meio cento somam em unidades, junto com os salgados dos kits', () => {
  const linhas = ctx.linhasProducao([
    pedido('a', item('salgado-fritos-cento', 2, '100 coxinhas, 100 kibes')),
    pedido('b', item('salgado-fritos-meio-cento', 1), item('kit-festa-10-pessoas', 1)),
    pedido('c', item('kit-15-pessoas', 2), item('salgado-assados-cento', 1))
  ], produtos);
  const fritos = linhas.find(l => l.nome === 'Mini salgados fritos');
  assert.equal(fritos.qtd, 200 + 50 + 80 + 2 * 120);
  assert.equal(fritos.pedidos.size, 3);
  assert.deepEqual(js([...fritos.partes]), [['cento', 2], ['meio cento', 1], ['nos kits', 320]]);
  assert.equal(linhas.find(l => l.nome === 'Mini salgados assados').qtd, 100);   // assados ficam à parte
  assert.equal(linhas.find(l => l.nome === 'Docinhos').qtd, 20 + 2 * 20);
  const kit = linhas.find(l => l.nome === 'Kit 15 Pessoas');
  assert.equal(kit.qtd, 2); assert.ok(kit.kit);
});

test('kit de salgados assados do atacado soma com o cento de assados', () => {
  const kitAssados = { id: 'kit-assados', slug: 'atacado-kit-salgados-assados', nome: 'Kit de salgados assados', unidade_preco: 'kit',
    descricao: '100 mini salgados assados. Sabores: Doguinho, presunto e queijo, esfirra de frango.', grupo_nome: null, categoria_nome: 'Bolo no pote (atacado)' };
  const linhas = ctx.linhasProducao([
    pedido('a', item('salgado-assados-cento', 1)),
    pedido('b', { produto_id: 'kit-assados', nome: kitAssados.nome, quantidade: 3, observacao: '100 esfirras de frango, 200 doguinhos' })
  ], [...produtos, kitAssados]);
  const assados = linhas.find(l => l.nome === 'Mini salgados assados');
  assert.equal(assados.qtd, 100 + 3 * 100);
  assert.deepEqual(js([...assados.partes]), [['cento', 1], ['nos kits', 300]]);
  assert.ok(!linhas.some(l => l.nome === 'Mini salgados fritos'));
});
