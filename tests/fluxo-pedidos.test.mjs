import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { DADOS_DEMO } from '../demo/dados-demo.js';

// Backoffice: o próximo passo de cada pedido (botão da lista, do quadro e da gaveta) e a busca de produto do novo pedido
const app = readFileSync(new URL('../backoffice/app.js', import.meta.url), 'utf8');
const trecho = (inicio, fim) => {
  const i = app.indexOf(inicio), j = app.indexOf(fim, i + inicio.length);
  assert.ok(i >= 0 && j > i, `Trecho não encontrado: ${inicio}`);
  return app.slice(i, j);
};
const js = v => JSON.parse(JSON.stringify(v));   // objetos do vm têm outro protótipo

// os status como vêm do banco, na ordem do fluxo
const STATUS = [
  { codigo: 'recebido', nome: 'Recebido', ordem: 1, ativo: true },
  { codigo: 'confirmado', nome: 'Confirmado', ordem: 2, ativo: true },
  { codigo: 'em_producao', nome: 'Em produção', ordem: 3, ativo: true },
  { codigo: 'pronto', nome: 'Pronto para retirada', ordem: 4, ativo: true },
  { codigo: 'em_rota', nome: 'Saiu para entrega', ordem: 5, ativo: true },
  { codigo: 'retirado', nome: 'Retirado', ordem: 6, ativo: true, finalizado: true },
  { codigo: 'entregue', nome: 'Entregue', ordem: 7, ativo: true, finalizado: true },
  { codigo: 'cancelado', nome: 'Cancelado', ordem: 9, ativo: true, finalizado: true }
];
const ctx = vm.createContext({ STATUS, $: () => null });
const codigo = [
  trecho('const statusDe =', '\n'),
  trecho('const ICONE_STATUS =', '\n'),
  trecho('const semAcento =', '\n'),
  trecho('function confirmadoEmDiante(p)', 'function cartaoHoje('),
  trecho('const ehEntrega = p =>', 'const kmTxt'),
  trecho('function proximoStatus(p)', 'const gavetaMostra'),
  trecho('function buscarProdutos(', '/** Novo pedido: digite parte')
].join('\n').replace(/^const /gm, 'var ');
// do trecho do "Hoje" só interessam as funções (as variáveis de tela ficam de fora)
vm.runInContext(codigo.replace(/^(let|var) hoje[A-Za-z]*\b[^\n]*\n/gm, ''), ctx);

const pedido = (status, extra = {}) => ({ status, total: 200, valor_sinal: 100, valor_pago: 0, sinal_pago: false, ...extra });
const passo = p => { const a = ctx.proximaAcao(p); return a && js({ tipo: a.tipo, codigo: a.codigo, rot: a.rot }); };

test('pedido recebido sem sinal: o próximo passo é registrar o sinal (que já confirma)', () => {
  assert.deepEqual(passo(pedido('recebido')), { tipo: 'pagar', rot: 'Registrar sinal' });
});

test('com o sinal pago, cada etapa leva à seguinte', () => {
  const pago = { sinal_pago: true, valor_pago: 100 };
  assert.deepEqual(passo(pedido('recebido', pago)), { tipo: 'status', codigo: 'confirmado', rot: 'Confirmar' });
  assert.deepEqual(passo(pedido('confirmado', pago)), { tipo: 'status', codigo: 'em_producao', rot: 'Iniciar produção' });
  assert.deepEqual(passo(pedido('em_producao', pago)), { tipo: 'status', codigo: 'pronto', rot: 'Marcar pronto' });
});

test('pronto: retirada termina em "retirado"; entrega sai para entrega e termina em "entregue"', () => {
  const pago = { sinal_pago: true, valor_pago: 100 };
  assert.deepEqual(passo(pedido('pronto', pago)), { tipo: 'status', codigo: 'retirado', rot: 'Marcar retirado' });
  const ent = { ...pago, entrega: { endereco: 'Rua X, 1', taxa: 10 } };
  assert.deepEqual(passo(pedido('pronto', ent)), { tipo: 'status', codigo: 'em_rota', rot: 'Sair para entrega' });
  assert.deepEqual(passo(pedido('em_rota', ent)), { tipo: 'status', codigo: 'entregue', rot: 'Marcar entregue' });
});

test('pedido sem valor não pede sinal; concluído e cancelado não têm próximo passo', () => {
  assert.deepEqual(passo(pedido('recebido', { total: 0, valor_sinal: 0 })), { tipo: 'status', codigo: 'confirmado', rot: 'Confirmar' });
  assert.equal(passo(pedido('retirado', { sinal_pago: true })), null);
  assert.equal(passo(pedido('cancelado')), null);
});

test('sem o campo sinal_pago (pedido completo), o sinal conta pelo valor pago', () => {
  assert.equal(passo(pedido('recebido', { sinal_pago: undefined, valor_pago: 100 })).codigo, 'confirmado');
  assert.equal(passo(pedido('recebido', { sinal_pago: undefined, valor_pago: 40 })).tipo, 'pagar');
});

test('busca de produto: o mais relevante vem primeiro e acento não atrapalha', () => {
  const cat = Object.fromEntries(DADOS_DEMO.categorias.map(c => [c.id, c.nome]));
  const produtos = DADOS_DEMO.produtos.map(p => ({ ...p, categoria: cat[p.categoria_id] }));
  const nomes = t => js(ctx.buscarProdutos(produtos, t).map(p => p.nome));
  assert.match(nomes('coca')[0], /^Coca-Cola/);
  assert.ok(nomes('coca').some(n => /Paçoca/.test(n)), 'paçoca continua aparecendo, depois da Coca-Cola');
  assert.equal(nomes('ninho mor')[0], 'Bolo Ninho + Morango');
  assert.ok(nomes('pacoca').some(n => /Paçoca/.test(n)));
  assert.deepEqual(nomes('   '), []);
});
