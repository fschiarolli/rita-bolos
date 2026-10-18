import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as api from '../js/rita-api.js';

const { lerObservacao, escolhasDoItem, detalhesDoItem, agruparFinalizacoes, juntarReferencia } = api;
const back = readFileSync(new URL('../backoffice/app.js', import.meta.url), 'utf8');
const js = v => JSON.parse(JSON.stringify(v));   // compara objetos de outro contexto (vm)

const KIT_FESTA = 'Bolo de 1 kg, 80 salgadinhos fritos, 20 docinhos e refrigerante 2 L.';
const KIT_30 = '3 kg de bolo, 250 salgados fritos, 50 docinhos, 1 topper e 5 refrigerantes 2 L.';
const obsKit = (topo, notas = '') => ['Sabor do bolo: Ninho com morango', 'Formato do bolo: Quadrado', 'Massa do bolo: Preta',
  'Sabores dos salgados fritos: 40 coxinhas\n40 kibes', 'Sabores dos docinhos: 10 brigadeiros', `Topo do bolo: ${topo}`, notas].filter(Boolean).join('\n');

/** As etiquetas do app.js (do bloco das etiquetas), com o conteúdo dos kits pelo nome. */
function etiquetas(kits = {}) {
  const a = back.indexOf('/* ---- Etiquetas: o que sai em cada uma ----'), b = back.indexOf('/** Tamanho da etiqueta em pontos');
  assert.ok(a >= 0 && b > a);
  const ctx = vm.createContext({ ...api, R: api.formatarPreco, DIAS: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'], hora: t => String(t).slice(0, 5),
    kitDoItem: i => kits[i.nome] || null, confNiimbot: () => ({ conteudo: 'producao' }) });
  vm.runInContext(back.slice(a, b).replace(/^(const|let) /gm, 'var '), ctx);
  return ctx;
}
const pedido = itens => ({ codigo: 'RB-01', cliente_nome: 'Maria Aparecida dos Santos', data_retirada: '2026-10-19', hora_retirada: '15:30:00', itens });

test('a observação do kit vira campos, notas e imagem (o topo fecha os campos)', () => {
  const o = lerObservacao(juntarReferencia(obsKit('Sim', 'Nome no topo: Helena\nSabor do bolo: não é campo'), 'https://x.example/topo.png'));
  assert.deepEqual(o.kit, { sabor: 'Ninho com morango', formato: 'Quadrado', massa: 'Preta', salgados: '40 coxinhas\n40 kibes', docinhos: '10 brigadeiros', topo: 'Sim' });
  assert.equal(o.notas, 'Nome no topo: Helena\nSabor do bolo: não é campo');
  assert.equal(o.imagem, 'https://x.example/topo.png');
  assert.deepEqual(lerObservacao('Sem amendoim'), { campos: [], kit: {}, notas: 'Sem amendoim', imagem: null });
});

test('escolhas do bolo avulso e do kit saem no mesmo formato', () => {
  const avulso = escolhasDoItem({ massa: 'Massa preta', formato: 'redondo', segundo_recheio: 'Ninho + Nutella', observacao: 'Escrever Parabéns' });
  assert.equal(avulso.massa, 'Massa preta'); assert.equal(avulso.formato, 'Redondo'); assert.equal(avulso.segundo, 'Ninho + Nutella');
  assert.equal(avulso.notas, 'Escrever Parabéns'); assert.equal(avulso.topo, '');
  const kit = escolhasDoItem({ observacao: obsKit('Não', 'Tema: safari') });
  assert.equal(kit.sabor, 'Ninho com morango'); assert.equal(kit.massa, 'Massa preta'); assert.equal(kit.formato, 'Quadrado'); assert.equal(kit.topo, 'Não');
  assert.deepEqual(kit.outros.map(o => o.rotulo), ['Salgados fritos', 'Docinhos']);
  assert.equal(kit.notas, 'Tema: safari');
});

test('detalhes do recibo: o bolo do kit numa linha; kit sem bolo não fala de topo', () => {
  const { linhas, notas } = detalhesDoItem({ observacao: obsKit('Sim', 'Tema: jardim') });
  assert.deepEqual(linhas[0], { rotulo: 'Bolo', valor: 'Ninho com morango · Massa preta · Quadrado · Com topo' });
  assert.deepEqual(linhas.slice(1).map(l => l.rotulo), ['Salgados fritos', 'Docinhos']);
  assert.equal(notas, 'Tema: jardim');
  assert.deepEqual(detalhesDoItem({ massa: 'Massa branca', formato: 'Redondo' }).linhas, [{ rotulo: '', valor: 'Massa branca · Redondo' }]);
  assert.deepEqual(detalhesDoItem({ observacao: 'Sabores dos pastéis: Queijo\nTopo do bolo: Não' }).linhas, [{ rotulo: 'Pastéis', valor: 'Queijo' }]);
});

test('a finalização fica embaixo do bolo dela; sem dono, segue como item', () => {
  const bolo1 = { nome: 'Bolo Ninho', peso_kg: 2 }, bolo2 = { nome: 'Bolo Ninho', peso_kg: 1.5 };
  const fin = obs => ({ nome: 'Finalização colorida', observacao: obs });
  const g = agruparFinalizacoes([bolo1, fin('Bolo: Bolo Ninho 2 kg'), bolo2, fin('Bolo: Bolo Ninho 1,5 kg'), { nome: 'Brigadeiro' }, fin('Bolo: Outro 3 kg'), fin(null)]);
  assert.deepEqual(g.map(x => [x.item.nome, x.fins.length]), [['Bolo Ninho', 1], ['Bolo Ninho', 1], ['Brigadeiro', 0], ['Finalização colorida', 0], ['Finalização colorida', 0]]);
  assert.equal(g[1].item, bolo2);
});

test('etiqueta do bolo do kit: sabor, peso, massa e formato das escolhas; topo pela escolha gravada', () => {
  const ctx = etiquetas({ 'Kit Festa 10 Pessoas': KIT_FESTA, 'Kit 30 Pessoas': KIT_30 });
  const p = pedido([{ nome: 'Kit Festa 10 Pessoas', quantidade: 1, observacao: obsKit('Não', 'Tema da festa: safari') },
    { nome: 'Finalização colorida', quantidade: 1 }]);
  const [et, ...resto] = ctx.etiquetasDoPedido(p);
  assert.equal(resto.length, 0);
  const d = js(ctx.textosEtiquetaBolo(et));
  assert.equal(d.recheio, 'Ninho com morango'); assert.equal(d.peso, '1 kg');
  assert.equal(d.massa, 'Massa preta'); assert.equal(d.formato, 'Quadrado');
  assert.equal(d.topo, false); assert.equal(d.obs, 'Tema da festa: safari');
  assert.deepEqual(d.fins, [{ longo: 'Finalização colorida', curto: 'Colorida' }]);
  assert.equal(d.nome, 'Maria Aparecida dos Santos'); assert.equal(d.horario, '15:30'); assert.equal(d.dia, 'Seg 19/10');
  // kit com topo: a escolha "Sim" vale; a descrição do kit só decide em pedido antigo, sem a escolha
  const comTopo = js(ctx.textosEtiquetaBolo(ctx.etiquetasDoPedido(pedido([{ nome: 'Kit 30 Pessoas', quantidade: 1, observacao: obsKit('Sim') }]))[0]));
  assert.equal(comTopo.topo, true); assert.equal(comTopo.qualTopo, 'vem no kit'); assert.equal(comTopo.peso, '3 kg');
  const antigo = js(ctx.textosEtiquetaBolo(ctx.etiquetasDoPedido(pedido([{ nome: 'Kit 30 Pessoas', quantidade: 1, observacao: 'Chocolate' }]))[0]));
  assert.equal(antigo.recheio, 'Kit 30 Pessoas'); assert.equal(antigo.topo, true); assert.equal(antigo.obs, 'Chocolate');
});

test('etiqueta do bolo avulso: finalização só no bolo dela, topper avulso e dois bolos iguais', () => {
  const ctx = etiquetas();
  const p = pedido([
    { nome: 'Bolo Ninho + Morango', quantidade: 1, peso_kg: 2, massa: 'Massa preta', formato: 'Redondo', segundo_recheio: 'Ninho + Nutella' },
    { nome: 'Finalização com glitter', quantidade: 1, observacao: 'Bolo: Bolo Ninho + Morango 2 kg' },
    { nome: 'Bolo Floresta Negra', quantidade: 2, peso_kg: 1.5, massa: 'Massa branca', formato: 'Quadrado' },
    { nome: 'Topper luxo', quantidade: 1, observacao: 'Futebol' }]);
  const ets = ctx.etiquetasDoPedido(p);
  assert.equal(ets.length, 3);
  const [a, b] = ets.map(et => js(ctx.textosEtiquetaBolo(et)));
  assert.equal(a.recheio, 'Ninho + Morango'); assert.equal(a.peso, '2 kg'); assert.equal(a.segundo, 'Ninho + Nutella');
  assert.deepEqual(a.fins, [{ longo: 'Finalização com glitter', curto: 'Glitter' }]);
  assert.equal(a.qual, 'bolo 1 de 3'); assert.equal(a.qualTopo, 'Topper luxo');
  assert.deepEqual(b.fins, []); assert.equal(b.qual, 'bolo 2 de 3'); assert.equal(b.massa, 'Massa branca');
  assert.equal(b.notaTopo[0], '1 topo para 3 bolos: confira no pedido');
});
