/**
 * Supabase de demonstração
 * ------------------------------------------------------------------
 * Imita, dentro do navegador, o banco criado pelos scripts SQL
 * (tabelas, funções da API, login e fotos). Serve para:
 *   - experimentar o site e o backoffice sem conectar ao Supabase (?demo)
 *   - testes automáticos
 * Os dados ficam no localStorage deste navegador. Nada vai para a internet.
 */
import { DADOS_DEMO } from './dados-demo.js';

const CHAVE = 'ritabolos.demo.v2';
const USUARIO_DEMO = { id: '00000000-0000-4000-8000-000000000001', email: 'rita@demo.com.br' };
const TABELAS_COM_ATUALIZADO = ['configuracoes', 'categorias', 'grupos', 'produtos', 'bolo_massas', 'bolo_formatos', 'banners', 'avisos', 'pedidos', 'pedido_observacoes', 'topos_pedidos'];
/* Quem produz os personalizados na demonstração: entre com topos@demo.com.br para ver o backoffice como ela vê */
const PRODUTORA_DEMO = { user_id: '00000000-0000-4000-8000-000000000002', nome: 'Bia Andrade', email: 'topos@demo.com.br', ativo: true, avatar: null };
const TABELAS_TOPOS = ['topos_pedidos', 'topos_historico'];
/** Aviso "topo pronto" para a equipe da loja (o mesmo texto do gatilho em sql/topos.sql). */
function avisoTopoPronto(lista, t) {
  const cod = 'TP-' + String(t.numero).padStart(4, '0'), oque = t.tipo === 'personalizado' ? 'personalizado' : 'topo', qtd = t.quantidade > 1 ? `${t.quantidade}× ` : '';
  lista.push({ id: lista.reduce((m, n) => Math.max(m, n.id), 0) + 1, tipo: 'topo_pronto', titulo: oque === 'topo' ? 'Topo pronto' : 'Personalizado pronto',
    texto: t.pedido_codigo ? `O ${oque} do pedido ${t.pedido_codigo}${t.cliente_nome ? ` (${t.cliente_nome})` : ''} está pronto: ${qtd}${t.titulo} · ${cod}.`
      : `O ${oque} ${cod} (${qtd}${t.titulo})${t.cliente_nome ? ` de ${t.cliente_nome}` : ''} está pronto.`,
    pedido_id: t.pedido_id || null, topo_id: t.id, criado_em: new Date().toISOString(), lida_em: null });
  return lista[lista.length - 1];
}
const UNICOS = { categorias: ['slug'], produtos: ['slug'], bolo_massas: ['slug'], bolo_formatos: ['slug'], status_pedido: ['codigo'], bolo_pesos: ['peso_kg'] };
const CHAVES = { status_pedido: 'codigo', bolo_pesos: 'peso_kg', administradores: 'user_id' };

const clone = o => JSON.parse(JSON.stringify(o));
const agora = () => new Date().toISOString();
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(16).slice(2) + Date.now());
const r2 = n => Math.round(Number(n) * 100) / 100;
const erro = (message, code = 'P0001') => ({ data: null, error: { message, code } });
function hojeSP(offset = 0) {
  const d = new Date(Date.now() + offset * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
function somarDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export function criarSupabaseDemo(opcoes = {}) {
  const imagens = opcoes.imagens || {};
  const prefixoImagens = opcoes.prefixoImagens ?? 'imagens/';
  // anonimo: o site público não enxerga o login do backoffice
  let sessao = opcoes.anonimo ? null : (() => { try { return JSON.parse(localStorage.getItem(CHAVE + '.sessao')); } catch (e) { return null; } })();
  const ouvintesAuth = new Set();
  const canais = new Set();
  let db = null;  // carregado no fim (depois de todas as funções existirem)

  function carregar() {
    try { const s = localStorage.getItem(CHAVE); if (s) return migrar(JSON.parse(s)); } catch (e) {}
    db = migrar(clone(DADOS_DEMO));
    db.bolo_formatos = db.bolo_formatos || [
      { id: novoId(), slug: 'redondo', nome: 'Redondo', descricao: null, ordem: 1, ativo: true, criado_em: agora(), atualizado_em: agora() },
      { id: novoId(), slug: 'quadrado', nome: 'Quadrado', descricao: null, ordem: 2, ativo: true, criado_em: agora(), atualizado_em: agora() }];
    db._seq = 1000;
    pedidosExemplo();
    return db;
  }
  /** Acrescenta ao banco (novo ou salvo) o que veio depois: prejuízos e finalização do bolo (igual a sql/finalizacao-bolo.sql). */
  function migrar(b) {
    b.prejuizos = b.prejuizos || [];
    // Pix e horários de retirada em Ajustes > Loja (igual a sql/ajustes-loja.sql)
    const cf = b.configuracoes?.[0];
    if (cf && !('pix_chave' in cf)) Object.assign(cf, { pix_chave: '06954518808', pix_tipo: 'CPF', pix_nome: 'Valdemir Schiarolli' });
    if (cf && !('retirada_inicio' in cf)) Object.assign(cf, { retirada_inicio: '08:00:00', retirada_fim: '18:00:00', retirada_intervalo_min: 30, retirada_dias: 14 });
    // Topos e personalizados (igual a sql/topos.sql), com alguns pedidos de exemplo
    b.produtores_personalizados = b.produtores_personalizados || [{ ...PRODUTORA_DEMO, criado_em: agora() }];
    if (!b.topos_pedidos) semearTopos(b);
    if (!b.notificacoes) { b.notificacoes = []; b.topos_pedidos.filter(t => t.status === 'pronto').forEach(t => avisoTopoPronto(b.notificacoes, t)); }
    const adic = (b.categorias || []).find(c => c.slug === 'adicionais');
    if (adic) {
      [['finalizacao-colorida', 'Finalização colorida', 'Colorido', 'Cobertura ou decoração colorida.', 90],
       ['finalizacao-glitter', 'Finalização com glitter', 'Com glitter', 'Brilho comestível na decoração.', 91]].forEach(([slug, nome, rotulo, descricao, ordem]) => {
        if (b.produtos.some(p => p.slug === slug)) return;
        b.produtos.push({ id: novoId(), categoria_id: adic.id, grupo_id: null, slug, nome, preco: 15, rotulo, descricao, tipo: 'simples', unidade_preco: 'unidade',
          quantidade_por_unidade: null, pede_observacao: false, observacao_obrigatoria: false, rotulo_observacao: null, exemplo_observacao: null, selo: null, selo_estilo: null,
          imagem_path: null, ilustracao: null, destaque: false, destaque_ordem: null, antecedencia_minima_dias: 0, ordem, ativo: true, criado_em: agora(), atualizado_em: agora() });
      });
    }
    // bolo no pote no atacado (igual a sql/bolo-no-pote-atacado.sql): mesmos sabores a R$ 12, fora do cardápio do site
    const pote = (b.categorias || []).find(c => c.slug === 'bolo-no-pote');
    if (pote && !b.categorias.some(c => c.slug === 'bolo-no-pote-atacado')) {
      const atac = { ...pote, id: novoId(), slug: 'bolo-no-pote-atacado', nome: 'Bolo no pote (atacado)', layout: 'pagina', link_externo: null,
        introducao: 'Bolo no pote para festas, eventos e revenda. Todos os sabores R$ 12,00 a unidade.', aceita_pedido_online: true, ativo: true,
        ordem: (pote.ordem || 0) + 100, criado_em: agora(), atualizado_em: agora() };
      b.categorias.push(atac);
      b.produtos.filter(p => p.categoria_id === pote.id).forEach(p => {
        if (!b.produtos.some(x => x.slug === 'atacado-' + p.slug))
          b.produtos.push({ ...p, id: novoId(), categoria_id: atac.id, slug: 'atacado-' + p.slug, preco: 12, destaque: false, destaque_ordem: null, criado_em: agora(), atualizado_em: agora() });
      });
    }
    return b;
  }
  function semearTopos(b) {
    b._seqTopo = 0; b.topos_historico = [];
    const t = o => ({ id: novoId(), numero: ++b._seqTopo, tipo: 'topo', titulo: 'Topo de papel', tema: null, texto: null, quantidade: 1, detalhes: null, referencias: [],
      cliente_nome: null, cliente_telefone: null, pedido_id: null, pedido_codigo: null, pedido_item_id: null, hora_entrega: null, status: 'novo', valor: 0, pago: false,
      criado_por: USUARIO_DEMO.id, criado_em: agora(), atualizado_em: agora(), ...o });
    b.topos_pedidos = [
      t({ tema: 'Safari', texto: 'Theo, 1 ano', detalhes: 'Bichinhos em volta do nome, tons de verde e bege.', data_entrega: hojeSP(0), hora_entrega: '09:00:00', status: 'pronto', valor: 25, cliente_nome: 'Maria Souza' }),
      t({ titulo: 'Topo 3D em camadas', tema: 'Frozen', texto: 'Alice, 5 anos', data_entrega: hojeSP(0), hora_entrega: '14:00:00', status: 'em_producao', valor: 35, cliente_nome: 'Ana Lima' }),
      t({ tema: 'Futebol (verde e branco)', texto: 'Parabéns, Pedro!', data_entrega: hojeSP(1), hora_entrega: '10:00:00', valor: 20, cliente_nome: 'João Pereira' }),
      t({ tipo: 'personalizado', titulo: 'Caixinhas para doces', tema: 'Chá de bebê, tons de verde', texto: 'Chá da Helena', quantidade: 30, data_entrega: hojeSP(3), valor: 90,
        cliente_nome: 'Juliana Prado', cliente_telefone: '(19) 99812-3344', detalhes: 'Caixinha milk com laço de cetim.' }),
      t({ tipo: 'personalizado', titulo: 'Tags para lembrancinhas', tema: 'Batizado', texto: 'Batizado do Miguel', quantidade: 50, data_entrega: hojeSP(-1), status: 'entregue', valor: 60, pago: true,
        cliente_nome: 'Marcos Silva', cliente_telefone: '(19) 98111-2233' })
    ];
    const caminho = { novo: ['novo'], em_producao: ['novo', 'em_producao'], pronto: ['novo', 'em_producao', 'pronto'], entregue: ['novo', 'em_producao', 'pronto', 'entregue'] };
    b.topos_pedidos.forEach(p => (caminho[p.status] || ['novo']).forEach((s, i, l) => b.topos_historico.push({ id: b.topos_historico.length + 1, topo_id: p.id,
      status_anterior: i ? l[i - 1] : null, status_novo: s, autor_id: i ? PRODUTORA_DEMO.user_id : USUARIO_DEMO.id, autor_nome: i ? PRODUTORA_DEMO.nome : 'Rita', criado_em: agora() })));
  }
  function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch (e) {} }

  // Outras abas (site demo ↔ backoffice demo) avisam sobre pedidos novos
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', e => {
      if (e.key !== CHAVE || !e.newValue) return;
      const antes = new Set(db.pedidos.map(p => p.id)), toposAntes = JSON.stringify(db.topos_pedidos || []);
      const avisosAntes = new Set((db.notificacoes || []).map(n => n.id)), vistosAntes = (db.notificacoes || []).filter(n => n.lida_em).length;
      db = JSON.parse(e.newValue);
      db.pedidos.filter(p => !antes.has(p.id)).forEach(p => emitir('INSERT', p));
      if (JSON.stringify(db.topos_pedidos || []) !== toposAntes) emitir('UPDATE', db.topos_pedidos?.[0] || {}, null, 'topos_pedidos');
      (db.notificacoes || []).filter(n => !avisosAntes.has(n.id)).forEach(n => emitir('INSERT', n, null, 'notificacoes'));
      if ((db.notificacoes || []).filter(n => n.lida_em).length !== vistosAntes) emitir('UPDATE', {}, null, 'notificacoes');
    });
  }
  /** Avisa os canais de tempo real que ouvem a tabela (pedidos, se nenhuma for dita). */
  function emitir(tipo, novo, antigo, tabela = 'pedidos') {
    canais.forEach(c => c.ouvintes.forEach(([t, o]) => { if (t && t !== tabela) return; try { o({ eventType: tipo, new: novo || {}, old: antigo || {} }); } catch (e) {} }));
  }

  /* ----------------------- regras (gatilhos) ----------------------- */
  const cfg = () => db.configuracoes[0];
  const status = c => db.status_pedido.find(s => s.codigo === c) || {};
  function recalcularPedido(p) {
    p.subtotal = r2(db.pedido_itens.filter(i => i.pedido_id === p.id).reduce((s, i) => s + i.preco_unitario * i.quantidade, 0));
    p.desconto = Math.min(Number(p.desconto || 0), p.subtotal);
    p.total = r2(p.subtotal - p.desconto);
    p.valor_sinal = r2(p.total * p.percentual_sinal / 100);
    p.valor_pago = r2(db.pedido_pagamentos.filter(g => g.pedido_id === p.id).reduce((s, g) => s + Number(g.valor), 0));
  }
  function historico(pedidoId, de, para, comentario) {
    db.pedido_historico.push({ id: db.pedido_historico.length + 1, pedido_id: pedidoId, status_anterior: de, status_novo: para,
      comentario: comentario || null, alterado_por: sessao ? USUARIO_DEMO.id : null, alterado_em: agora() });
  }
  // como as regras do banco: a equipe é quem está em administradores; quem produz personalizados só mexe nos topos
  const usuarioId = () => sessao?.user?.id || null;
  const equipe = () => !!sessao && db.administradores.some(a => a.user_id === usuarioId() && a.ativo);
  const adminLoja = () => !!sessao && db.administradores.some(a => a.user_id === usuarioId() && a.ativo && a.papel === 'admin');
  const podeTopos = () => adminLoja() || (db.produtores_personalizados || []).some(p => p.user_id === usuarioId() && p.ativo);
  const nomeAdmin = id => db.administradores.find(a => a.user_id === id)?.nome || (db.produtores_personalizados || []).find(p => p.user_id === id)?.nome || null;

  /* ----------------------- vistas ----------------------- */
  function vista(nome) {
    if (nome === 'vw_pedidos') return db.pedidos.map(p => {
      const s = status(p.status), itens = db.pedido_itens.filter(i => i.pedido_id === p.id).sort((a, b) => a.ordem - b.ordem);
      return { ...p, status_nome: s.nome, status_cor: s.cor, status_ordem: s.ordem, finalizado: !!s.finalizado,
        saldo: Math.max(r2(p.total - p.valor_pago), 0), sinal_pago: p.valor_pago >= p.valor_sinal, qtd_itens: itens.length,
        resumo_itens: itens.map(i => `${i.quantidade}× ${i.nome}${i.peso_kg ? ' ' + String(i.peso_kg).replace('.', ',') + ' kg' : ''}${i.formato ? ' ' + i.formato.toLowerCase() : ''}`).join(', '),
        qtd_observacoes: db.pedido_observacoes.filter(o => o.pedido_id === p.id).length };
    });
    if (nome === 'vw_produtos') return db.produtos.map(p => {
      const c = db.categorias.find(x => x.id === p.categoria_id) || {}, g = db.grupos.find(x => x.id === p.grupo_id);
      return { ...p, categoria_nome: c.nome, categoria_slug: c.slug, categoria_ordem: c.ordem, grupo_nome: g?.nome ?? null, grupo_ordem: g?.ordem ?? null };
    });
    return db[nome];
  }

  /* ----------------------- consultas (from) ----------------------- */
  function from(tabela) {
    const q = { op: 'select', filtros: [], ordens: [], faixa: null, unico: null, contar: false, dados: null, retornar: false };
    const api = {
      select(_c, o) { if (q.op !== 'select') q.retornar = true; if (o?.count) q.contar = true; return api; },
      insert(d) { q.op = 'insert'; q.dados = d; return api; },
      update(d) { q.op = 'update'; q.dados = d; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.filtros.push(r => r[c] == v); return api; },
      neq(c, v) { q.filtros.push(r => r[c] != v); return api; },
      in(c, l) { q.filtros.push(r => l.some(v => r[c] == v)); return api; },
      is(c, v) { q.filtros.push(r => (r[c] ?? null) === v); return api; },
      gte(c, v) { q.filtros.push(r => r[c] != null && r[c] >= v); return api; },
      lte(c, v) { q.filtros.push(r => r[c] != null && r[c] <= v); return api; },
      gt(c, v) { q.filtros.push(r => r[c] != null && r[c] > v); return api; },
      lt(c, v) { q.filtros.push(r => r[c] != null && r[c] < v); return api; },
      ilike(c, p) { const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*') + '$', 'i'); q.filtros.push(r => re.test(String(r[c] ?? ''))); return api; },
      or(expr) {
        const partes = expr.split(',').map(x => { const [c, op, ...v] = x.split('.'); return { c, op, v: v.join('.') }; });
        q.filtros.push(r => partes.some(({ c, op, v }) => op === 'ilike'
          ? new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*') + '$', 'i').test(String(r[c] ?? ''))
          : String(r[c]) === v));
        return api;
      },
      order(c, o = {}) { q.ordens.push([c, o.ascending !== false, o.nullsFirst]); return api; },
      range(a, b) { q.faixa = [a, b]; return api; },
      limit(n) { q.faixa = [0, n - 1]; return api; },
      single() { q.unico = 'single'; return api; },
      maybeSingle() { q.unico = 'maybe'; return api; },
      then(ok, falha) { return Promise.resolve().then(() => executar(tabela, q)).then(ok, falha); }
    };
    return api;
  }

  function executar(tabela, q) {
    const fonte = vista(tabela);
    if (!fonte) return erro(`Tabela ${tabela} não existe na demonstração.`, '42P01');
    const filtrar = r => q.filtros.every(f => f(r));
    if (TABELAS_TOPOS.includes(tabela)) {
      if (!podeTopos()) return q.op === 'select' ? finalizar([], q, 0) : erro('new row violates row-level security policy', '42501');
      if (q.op === 'delete' && !adminLoja()) return finalizar([], q, 0);   // excluir: só a Administração
      if (tabela === 'topos_historico' && q.op !== 'select') return erro('new row violates row-level security policy', '42501');
    }
    if (tabela === 'notificacoes') {   // só a equipe da loja vê e marca como visto; quem cria é o gatilho
      if (!equipe()) return q.op === 'select' ? finalizar([], q, 0) : erro('new row violates row-level security policy', '42501');
      if (q.op === 'insert' || q.op === 'delete') return erro('new row violates row-level security policy', '42501');
    }
    if (tabela === 'produtores_personalizados' && q.op === 'select') {
      const linhas = fonte.filter(filtrar).filter(r => adminLoja() || r.user_id === usuarioId());
      return finalizar(clone(linhas.sort((a, b) => a.nome.localeCompare(b.nome))), q, linhas.length);
    }
    if (q.op === 'select') {
      let linhas = fonte.filter(filtrar);
      for (const [c, asc, nf] of [...q.ordens].reverse()) {
        linhas = [...linhas].sort((a, b) => {
          const x = a[c], y = b[c];
          if (x == null && y == null) return 0;
          if (x == null) return nf ? -1 : 1;
          if (y == null) return nf ? 1 : -1;
          return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1);
        });
      }
      const total = linhas.length;
      if (q.faixa) linhas = linhas.slice(q.faixa[0], q.faixa[1] + 1);
      return finalizar(clone(linhas), q, total);
    }
    if (!equipe() && tabela !== 'pedidos' && !TABELAS_TOPOS.includes(tabela)) return erro('new row violates row-level security policy', '42501');
    if (q.op === 'insert') {
      const novos = (Array.isArray(q.dados) ? q.dados : [q.dados]).map(d => ({ ...padroes(tabela), ...clone(d) }));
      for (const n of novos) {
        for (const col of UNICOS[tabela] || []) if (fonte.some(r => r[col] == n[col])) return erro('duplicate key value violates unique constraint', '23505');
        fonte.push(n);
        aposEscrever(tabela, n, null);
      }
      salvar();
      return finalizar(clone(novos), q, novos.length);
    }
    if (q.op === 'update') {
      const alvo = fonte.filter(filtrar);
      for (const r of alvo) {
        const antigo = clone(r);
        for (const col of UNICOS[tabela] || []) if (q.dados[col] !== undefined && fonte.some(x => x !== r && x[col] == q.dados[col])) return erro('duplicate key value violates unique constraint', '23505');
        Object.assign(r, clone(q.dados));
        if (TABELAS_COM_ATUALIZADO.includes(tabela)) r.atualizado_em = agora();
        aposEscrever(tabela, r, antigo);
      }
      salvar();
      return finalizar(clone(alvo), q, alvo.length);
    }
    if (q.op === 'delete') {
      const alvo = fonte.filter(filtrar);
      if (tabela === 'categorias' && alvo.some(c => db.produtos.some(p => p.categoria_id === c.id))) return erro('violates foreign key constraint', '23503');
      if (tabela === 'grupos' && alvo.some(g => db.produtos.some(p => p.grupo_id === g.id))) return erro('violates foreign key constraint', '23503');
      if (tabela === 'status_pedido' && alvo.some(s => db.pedidos.some(p => p.status === s.codigo))) return erro('violates foreign key constraint', '23503');
      db[tabela] = fonte.filter(r => !alvo.includes(r));
      for (const r of alvo) aposEscrever(tabela, null, r);
      salvar();
      return finalizar(clone(alvo), q, alvo.length);
    }
  }
  function finalizar(linhas, q, total) {
    if (q.op !== 'select' && !q.retornar) return { data: null, error: null, count: null };
    if (q.unico === 'single') return linhas.length === 1 ? { data: linhas[0], error: null } : erro('JSON object requested, multiple (or no) rows returned', 'PGRST116');
    if (q.unico === 'maybe') return { data: linhas[0] ?? null, error: null };
    return { data: linhas, error: null, count: q.contar ? total : null };
  }
  function padroes(tabela) {
    const base = { criado_em: agora(), atualizado_em: agora() };
    const id = CHAVES[tabela] ? {} : { id: novoId() };
    const extra = {
      categorias: { ativo: true, ordem: 0, layout: 'lista', antecedencia_minima_dias: 0, aceita_pedido_online: true },
      grupos: { ativo: true, ordem: 0 }, produtos: { ...DEF_PRODUTO }, banners: { ativo: true, ordem: 0, estilo: 'chocolate' },
      avisos: { ativo: true, ordem: 0 }, bolo_massas: { ativo: true, ordem: 0 }, bolo_formatos: { ativo: true, ordem: 0 }, bolo_pesos: { ativo: true, ordem: 0 },
      status_pedido: { ativo: true, ordem: 0, finalizado: false }, administradores: { ativo: true, papel: 'admin' },
      pedido_observacoes: { fixada: false, autor_id: USUARIO_DEMO.id }, pedido_pagamentos: { tipo: 'sinal', forma: 'pix', pago_em: agora() },
      prejuizos: { quantidade: 1, data: hojeSP(), registrado_por: USUARIO_DEMO.id },
      topos_pedidos: { tipo: 'topo', quantidade: 1, referencias: [], status: 'novo', valor: 0, pago: false, criado_por: usuarioId() }
    }[tabela] || {};
    if (tabela === 'topos_pedidos') extra.numero = db._seqTopo = (db._seqTopo || 0) + 1;
    if (tabela === 'pedido_observacoes' || tabela === 'pedido_historico') id.id = Date.now() + Math.floor(Math.random() * 1000);
    return { ...base, ...id, ...extra };
  }
  function aposEscrever(tabela, novo, antigo) {
    if (tabela === 'pedidos' && novo) {
      if (antigo && novo.status !== antigo.status) historico(novo.id, antigo.status, novo.status, null);
      recalcularPedido(novo);
      emitir(antigo ? 'UPDATE' : 'INSERT', novo, antigo);
    }
    if (tabela === 'pedidos' && !novo && antigo) {
      for (const t of ['pedido_itens', 'pedido_historico', 'pedido_observacoes', 'pedido_pagamentos']) db[t] = db[t].filter(r => r.pedido_id !== antigo.id);
      emitir('DELETE', null, antigo);
    }
    if (['pedido_itens', 'pedido_pagamentos'].includes(tabela)) {
      const p = db.pedidos.find(x => x.id === (novo || antigo).pedido_id);
      if (p) { recalcularPedido(p); emitir('UPDATE', p); }
    }
    if (tabela === 'pedido_observacoes' && novo && !antigo) novo.autor_nome = nomeAdmin(novo.autor_id);
    if (tabela === 'topos_pedidos') {
      // gatilho do banco: histórico de status com quem mexeu
      if (novo && (!antigo || novo.status !== antigo.status))
        db.topos_historico.push({ id: db.topos_historico.length + 1, topo_id: novo.id, status_anterior: antigo?.status ?? null, status_novo: novo.status,
          autor_id: usuarioId(), autor_nome: nomeAdmin(usuarioId()), criado_em: agora() });
      if (!novo && antigo) {
        db.topos_historico = db.topos_historico.filter(h => h.topo_id !== antigo.id);
        db.notificacoes = (db.notificacoes || []).filter(n => n.topo_id !== antigo.id);
      }
      emitir(!antigo ? 'INSERT' : novo ? 'UPDATE' : 'DELETE', novo, antigo, 'topos_pedidos');
      // gatilho do banco: virou "pronto" → aviso para a equipe
      if (novo?.status === 'pronto' && antigo?.status !== 'pronto') emitir('INSERT', avisoTopoPronto(db.notificacoes = db.notificacoes || [], novo), null, 'notificacoes');
    }
    if (tabela === 'notificacoes' && novo) emitir('UPDATE', novo, antigo, 'notificacoes');
  }

  /* ----------------------- funções da API (rpc) ----------------------- */
  function produtoJson(p) {
    return { id: p.id, slug: p.slug, nome: p.nome, rotulo: p.rotulo || p.nome, descricao: p.descricao, tipo: p.tipo, preco: p.preco,
      unidade_preco: p.unidade_preco, quantidade_por_unidade: p.quantidade_por_unidade, pede_observacao: p.pede_observacao,
      observacao_obrigatoria: p.observacao_obrigatoria, rotulo_observacao: p.rotulo_observacao, exemplo_observacao: p.exemplo_observacao,
      selo: p.selo, selo_estilo: p.selo_estilo, imagem_path: p.imagem_path, ilustracao: p.ilustracao, antecedencia_minima_dias: p.antecedencia_minima_dias,
      faixas_preco: db.produto_faixas_preco.filter(f => f.produto_id === p.id).sort((a, b) => a.quantidade_minima - b.quantidade_minima)
        .map(f => ({ nome: f.nome, quantidade_minima: f.quantidade_minima, quantidade_maxima: f.quantidade_maxima, preco: f.preco })) };
  }
  const porOrdem = (a, b) => (a.ordem - b.ordem) || String(a.nome).localeCompare(String(b.nome));
  function obterCardapio() {
    const ativos = l => l.filter(x => x.ativo);
    const { id, atualizado_em, ...configuracoes } = cfg();
    return {
      gerado_em: agora(), configuracoes,
      categorias: ativos(db.categorias).sort(porOrdem).map(c => ({
        id: c.id, slug: c.slug, nome: c.nome, introducao: c.introducao, descricao: c.descricao, icone: c.icone, layout: c.layout,
        link_externo: c.link_externo, parceiro: c.parceiro, parceiro_logo_path: c.parceiro_logo_path, aviso: c.aviso,
        antecedencia_minima_dias: c.antecedencia_minima_dias, precos_validos_ate: c.precos_validos_ate, aceita_pedido_online: c.aceita_pedido_online,
        grupos: ativos(db.grupos).filter(g => g.categoria_id === c.id).sort(porOrdem).map(g => ({ id: g.id, nome: g.nome, info: g.info, sabores: g.sabores, icone: g.icone,
          produtos: ativos(db.produtos).filter(p => p.grupo_id === g.id).sort(porOrdem).map(produtoJson) })),
        produtos: ativos(db.produtos).filter(p => p.categoria_id === c.id && !p.grupo_id).sort(porOrdem).map(produtoJson)
      })),
      bolo: { pesos: ativos(db.bolo_pesos).sort((a, b) => a.ordem - b.ordem || a.peso_kg - b.peso_kg).map(p => p.peso_kg),
              massas: ativos(db.bolo_massas).sort(porOrdem).map(m => ({ id: m.id, slug: m.slug, nome: m.nome, descricao: m.descricao, cor: m.cor })),
              formatos: ativos(db.bolo_formatos || []).sort(porOrdem).map(f => ({ id: f.id, slug: f.slug, nome: f.nome, descricao: f.descricao })) },
      banners: ativos(db.banners).filter(b => (!b.inicio_em || b.inicio_em <= agora()) && (!b.fim_em || b.fim_em > agora())).sort((a, b) => a.ordem - b.ordem)
        .map(b => ({ id: b.id, titulo: b.titulo, subtitulo: b.subtitulo, texto_botao: b.texto_botao, link: b.link, imagem_path: b.imagem_path, imagem_secundaria_path: b.imagem_secundaria_path, estilo: b.estilo })),
      avisos: ativos(db.avisos).sort((a, b) => a.secao.localeCompare(b.secao) || a.ordem - b.ordem).map(a => ({ secao: a.secao, titulo: a.titulo, texto: a.texto, icone: a.icone })),
      destaques: db.produtos.filter(p => p.destaque && p.ativo && db.categorias.find(c => c.id === p.categoria_id)?.ativo
        && (!p.grupo_id || db.grupos.find(g => g.id === p.grupo_id)?.ativo)).sort((a, b) => (a.destaque_ordem ?? 1e9) - (b.destaque_ordem ?? 1e9)).map(p => p.slug)
    };
  }
  function pedidoJson(id, interno) {
    const p = db.pedidos.find(x => x.id === id); if (!p) return null;
    const s = status(p.status), c = cfg();
    const out = { id: p.id, numero: p.numero, codigo: p.codigo, origem: p.origem, status: p.status, status_nome: s.nome, status_cor: s.cor, finalizado: !!s.finalizado,
      cliente_nome: p.cliente_nome, cliente_telefone: interno ? p.cliente_telefone : null, data_retirada: p.data_retirada, hora_retirada: p.hora_retirada ? p.hora_retirada.slice(0, 5) : null,
      observacao_cliente: p.observacao_cliente, subtotal: p.subtotal, desconto: p.desconto, total: p.total, percentual_sinal: p.percentual_sinal, valor_sinal: p.valor_sinal,
      valor_pago: p.valor_pago, saldo: Math.max(r2(p.total - p.valor_pago), 0), criado_em: p.criado_em, atualizado_em: p.atualizado_em, token: interno ? p.token : null,
      itens: db.pedido_itens.filter(i => i.pedido_id === id).sort((a, b) => a.ordem - b.ordem).map(i => ({ id: i.id, produto_id: i.produto_id, categoria: i.categoria, nome: i.nome,
        preco_unitario: i.preco_unitario, quantidade: i.quantidade, subtotal: r2(i.preco_unitario * i.quantidade), peso_kg: i.peso_kg, preco_kg: i.preco_kg, massa: i.massa, formato: i.formato || null,
        segundo_recheio: i.segundo_recheio, faixa_preco: i.faixa_preco, observacao: i.observacao })),
      loja: { nome: c.nome_loja, slogan: c.slogan, logo_path: c.logo_path, whatsapp_numero: c.whatsapp_numero, whatsapp_exibicao: c.whatsapp_exibicao } };
    if (interno) Object.assign(out, {
      observacoes: db.pedido_observacoes.filter(o => o.pedido_id === id).sort((a, b) => (b.fixada - a.fixada) || (b.criado_em > a.criado_em ? 1 : -1))
        .map(o => ({ id: o.id, texto: o.texto, fixada: o.fixada, autor_nome: o.autor_nome, criado_em: o.criado_em })),
      historico: db.pedido_historico.filter(h => h.pedido_id === id).sort((a, b) => a.alterado_em > b.alterado_em ? 1 : -1)
        .map(h => ({ status_anterior: h.status_anterior, status_novo: h.status_novo, status_nome: status(h.status_novo).nome, comentario: h.comentario, alterado_por: nomeAdmin(h.alterado_por), alterado_em: h.alterado_em })),
      pagamentos: db.pedido_pagamentos.filter(g => g.pedido_id === id).sort((a, b) => a.pago_em > b.pago_em ? 1 : -1)
        .map(g => ({ id: g.id, tipo: g.tipo, forma: g.forma, valor: g.valor, pago_em: g.pago_em, observacao: g.observacao })) });
    return out;
  }
  function criarPedido(e) {
    const base = db, c = base.configuracoes[0], ehEquipe = equipe();
    if (!e || typeof e !== 'object') throw 'Pedido inválido.';
    if (!c.aceitando_pedidos && !ehEquipe) throw c.mensagem_pausa || 'No momento não estamos recebendo pedidos pelo site. Fale com a gente pelo WhatsApp.';
    if (e.chave_idempotencia) { const ja = base.pedidos.find(p => p.chave_idempotencia === e.chave_idempotencia); if (ja) return { id: ja.id, repetido: true }; }
    const nome = String(e.cliente_nome || '').trim();
    if (!nome) throw 'Informe o nome de quem está fazendo o pedido.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.data_retirada || '')) throw 'Data de retirada inválida.';
    if (!Array.isArray(e.itens) || !e.itens.length) throw 'A sacola está vazia.';
    let antecedencia = c.antecedencia_minima_dias || 0;
    const itens = e.itens.map((it, n) => {
      const p = base.produtos.find(x => (x.id === it.produto_id || x.slug === it.produto_slug) && x.ativo);
      if (!p) throw `O item "${it.nome || it.produto_slug || n + 1}" não está mais disponível. Atualize a página e confira a sacola.`;
      const cat = base.categorias.find(x => x.id === p.categoria_id);
      if (!cat.ativo || (!cat.aceita_pedido_online && !ehEquipe)) throw `"${p.nome}" não pode ser pedido pelo site no momento.`;
      const qtd = parseInt(it.quantidade, 10);
      if (!(qtd >= 1 && qtd <= 999)) throw `Quantidade inválida para "${p.nome}".`;
      const obs = String(it.observacao || '').trim() || null;
      if (p.observacao_obrigatoria && !obs) throw `Preencha "${p.rotulo_observacao || 'Observações'}" em "${p.nome}".`;
      antecedencia = Math.max(antecedencia, p.antecedencia_minima_dias || 0, cat.antecedencia_minima_dias || 0);
      const linha = { id: novoId(), produto_id: p.id, categoria: cat.nome, nome: p.nome, quantidade: qtd, peso_kg: null, preco_kg: null, massa: null,
        segundo_recheio_id: null, segundo_recheio: null, faixa_preco: null, observacao: obs, ordem: n + 1 };
      if (p.tipo === 'bolo') {
        const peso = Number(it.peso_kg);
        if (!base.bolo_pesos.some(b => b.ativo && Number(b.peso_kg) === peso)) throw `Escolha um peso válido para "${p.nome}".`;
        const m = base.bolo_massas.find(x => x.ativo && (x.slug === it.massa || x.id === it.massa_id));
        if (!m) throw `Escolha a massa de "${p.nome}".`;
        const formatos = (base.bolo_formatos || []).filter(x => x.ativo);
        let formato = null;
        if (formatos.length) {
          const f = formatos.find(x => x.slug === it.formato || x.id === it.formato_id);
          if (!f) throw `Escolha o formato de "${p.nome}".`;
          formato = f.nome;
        }
        let kg = p.preco;
        if (it.segundo_recheio_id || it.segundo_recheio_slug) {
          const r = base.produtos.find(x => (x.id === it.segundo_recheio_id || x.slug === it.segundo_recheio_slug) && x.tipo === 'bolo' && x.ativo);
          if (!r) throw `O 2º recheio escolhido para "${p.nome}" não está disponível.`;
          if (r.id === p.id) throw `O 2º recheio precisa ser diferente do sabor principal em "${p.nome}".`;
          kg = Math.max(kg, r.preco); linha.segundo_recheio_id = r.id; linha.segundo_recheio = r.rotulo || r.nome;
        }
        Object.assign(linha, { peso_kg: peso, preco_kg: kg, massa: m.nome, formato, preco_unitario: r2(kg * peso) });
      } else {
        const faixas = base.produto_faixas_preco.filter(f => f.produto_id === p.id && qtd >= f.quantidade_minima && (f.quantidade_maxima == null || qtd <= f.quantidade_maxima))
          .sort((a, b) => b.quantidade_minima - a.quantidade_minima);
        linha.preco_unitario = faixas[0] ? faixas[0].preco : p.preco; linha.faixa_preco = faixas[0]?.nome || null;
      }
      return linha;
    });
    const hoje = hojeSP();
    if (!ehEquipe) {
      const min = somarDias(hoje, antecedencia);
      if (e.data_retirada < min) throw antecedencia ? `Para este pedido a retirada precisa ser a partir de ${min.split('-').reverse().join('/')} (${antecedencia} dias de antecedência).` : 'A data de retirada não pode ser no passado.';
    }
    base._seq = (base._seq || 1000) + 1;
    const id = novoId();
    const origem = ehEquipe ? (['site', 'backoffice', 'whatsapp', 'balcao'].includes(e.origem) ? e.origem : 'backoffice') : 'site';
    const ped = { id, numero: base._seq, codigo: 'RB-' + String(base._seq).padStart(5, '0'), token: novoId(), chave_idempotencia: e.chave_idempotencia || null,
      origem, status: 'recebido', cliente_nome: nome, cliente_telefone: String(e.cliente_telefone || '').trim() || null, data_retirada: e.data_retirada,
      hora_retirada: e.hora_retirada ? e.hora_retirada.slice(0, 5) + ':00' : null, observacao_cliente: String(e.observacao || '').trim() || null,
      subtotal: 0, desconto: 0, total: 0, percentual_sinal: c.percentual_sinal, valor_sinal: 0, valor_pago: 0, criado_em: e._criado_em || agora(), atualizado_em: agora() };
    base.pedidos.push(ped);
    itens.forEach(i => base.pedido_itens.push({ ...i, pedido_id: id }));
    base.pedido_historico.push({ id: base.pedido_historico.length + 1, pedido_id: id, status_anterior: null, status_novo: 'recebido', comentario: `Pedido criado (${origem})`, alterado_por: null, alterado_em: ped.criado_em });
    recalcularPedido(ped); salvar(); emitir('INSERT', ped);
    return { id, repetido: false };
  }
  function pedidosExemplo() {
    const base = db;
    const exemplos = [
      { cliente_nome: 'Maria Souza', cliente_telefone: '(19) 99876-5432', data_retirada: hojeSP(0), hora_retirada: '16:00', _status: 'pronto', _pago: 'total',
        itens: [{ produto_slug: 'bolo-ninho-morango', quantidade: 1, peso_kg: 2.5, massa: 'preta', formato: 'redondo', segundo_recheio_slug: 'bolo-ninho-nutella', observacao: 'Escrever "Parabéns, Ana!"' },
                { produto_slug: 'docinho-brigadeiro-cento', quantidade: 100 }] },
      { cliente_nome: 'João Pereira', cliente_telefone: '(19) 98111-2233', data_retirada: hojeSP(1), hora_retirada: '10:00', _status: 'em_producao', _pago: 'sinal',
        itens: [{ produto_slug: 'kit-festa-10-pessoas', quantidade: 1, observacao: 'Bolo de brigadeiro; salgados: coxinha e kibe' }] },
      { cliente_nome: 'Ana Lima', data_retirada: hojeSP(2), hora_retirada: '14:30', _status: 'confirmado', _pago: 'sinal',
        itens: [{ produto_slug: 'salgado-fritos-cento', quantidade: 2, observacao: '100 coxinhas, 50 kibes, 50 queijo' }, { produto_slug: 'bebida-coca-cola-2-l', quantidade: 3 }] },
      { cliente_nome: 'Carla Mendes', cliente_telefone: '(19) 99700-1122', data_retirada: hojeSP(3), hora_retirada: '11:00', _status: 'recebido',
        itens: [{ produto_slug: 'bolo-floresta-negra', quantidade: 1, peso_kg: 2, massa: 'preta', formato: 'quadrado' }, { produto_slug: 'topper-luxo', quantidade: 1, observacao: 'Futebol, Pedro, 30 anos' }] }
    ];
    for (const ex of exemplos) {
      const { id } = criarPedido({ ...ex, _criado_em: new Date(Date.now() - 36e5 * (4 + Math.random() * 30)).toISOString() });
      const p = base.pedidos.find(x => x.id === id);
      recalcularPedido(p);
      if (ex._pago) {
        base.pedido_pagamentos.push({ id: novoId(), pedido_id: id, tipo: 'sinal', forma: 'pix', valor: p.valor_sinal, pago_em: p.criado_em, observacao: null, registrado_por: USUARIO_DEMO.id, criado_em: p.criado_em });
        if (ex._pago === 'total') base.pedido_pagamentos.push({ id: novoId(), pedido_id: id, tipo: 'restante', forma: 'dinheiro', valor: r2(p.total - p.valor_sinal), pago_em: agora(), observacao: null, registrado_por: USUARIO_DEMO.id, criado_em: agora() });
      }
      let anterior = 'recebido';
      for (const s of ['confirmado', 'em_producao', 'pronto']) {
        if (ex._status === 'recebido') break;
        base.pedido_historico.push({ id: base.pedido_historico.length + 1, pedido_id: id, status_anterior: anterior, status_novo: s, comentario: s === 'confirmado' ? 'Sinal recebido por Pix' : null, alterado_por: USUARIO_DEMO.id, alterado_em: agora() });
        anterior = s; if (s === ex._status) break;
      }
      p.status = ex._status; recalcularPedido(p);
    }
    const p1 = base.pedidos[0];
    base.pedido_observacoes.push({ id: 1, pedido_id: p1.id, texto: 'Cliente pediu caixa alta para transporte.', fixada: true, autor_id: USUARIO_DEMO.id, autor_nome: 'Rita', criado_em: agora(), atualizado_em: agora() });
  }

  const RPC = {
    obter_cardapio: () => obterCardapio(),
    criar_pedido: ({ p_pedido }) => { const { id, repetido } = criarPedido(p_pedido); return { ...pedidoJson(id, false), token: db.pedidos.find(p => p.id === id).token, repetido }; },
    consultar_pedido: ({ p_token }) => { const p = db.pedidos.find(x => x.token === p_token); return p ? pedidoJson(p.id, false) : null; },
    recibo_pedido: ({ p_pedido_id }) => { exigirEquipe(); const r = pedidoJson(p_pedido_id, true); if (!r) throw ['Pedido não encontrado.', 'P0002']; return r; },
    alterar_status_pedido: ({ p_pedido_id, p_status, p_comentario }) => {
      exigirEquipe();
      if (!db.status_pedido.some(s => s.codigo === p_status && s.ativo)) throw `Status "${p_status}" não existe.`;
      const p = db.pedidos.find(x => x.id === p_pedido_id); if (!p) throw ['Pedido não encontrado.', 'P0002'];
      if (p.status !== p_status) { const antigo = clone(p); historico(p.id, p.status, p_status, (p_comentario || '').trim()); p.status = p_status; p.atualizado_em = agora(); salvar(); emitir('UPDATE', p, antigo); }
      return pedidoJson(p.id, true);
    },
    adicionar_observacao_pedido: ({ p_pedido_id, p_texto, p_fixada }) => {
      exigirEquipe();
      if (!db.pedidos.some(x => x.id === p_pedido_id)) throw ['Pedido não encontrado.', 'P0002'];
      if (!String(p_texto || '').trim()) throw 'Escreva a observação.';
      const o = { id: Date.now(), pedido_id: p_pedido_id, texto: p_texto.trim(), fixada: !!p_fixada, autor_id: USUARIO_DEMO.id, autor_nome: nomeAdmin(USUARIO_DEMO.id), criado_em: agora(), atualizado_em: agora() };
      db.pedido_observacoes.push(o); salvar();
      return { id: o.id, texto: o.texto, fixada: o.fixada, autor_nome: o.autor_nome, criado_em: o.criado_em };
    },
    registrar_pagamento: ({ p_pedido_id, p_valor, p_forma, p_tipo, p_observacao, p_pago_em }) => {
      exigirEquipe();
      const p = db.pedidos.find(x => x.id === p_pedido_id); if (!p) throw ['Pedido não encontrado.', 'P0002'];
      if (!(Number(p_valor) > 0)) throw 'Informe um valor maior que zero.';
      db.pedido_pagamentos.push({ id: novoId(), pedido_id: p.id, tipo: p_tipo || 'sinal', forma: p_forma || 'pix', valor: r2(p_valor), pago_em: p_pago_em || agora(),
        observacao: String(p_observacao || '').trim() || null, registrado_por: USUARIO_DEMO.id, criado_em: agora() });
      recalcularPedido(p); salvar(); emitir('UPDATE', p);
      return pedidoJson(p.id, true);
    },
    resumo_painel: ({ p_data }) => {
      exigirEquipe();
      const hoje = p_data || hojeSP(), amanha = somarDias(hoje, 1);
      const abertos = db.pedidos.filter(p => !status(p.status).finalizado);
      return { data: hoje,
        por_status: db.status_pedido.filter(s => s.ativo).sort((a, b) => a.ordem - b.ordem).map(s => ({ status: s.codigo, nome: s.nome, cor: s.cor, finalizado: s.finalizado, quantidade: db.pedidos.filter(p => p.status === s.codigo).length })),
        novos_hoje: db.pedidos.filter(p => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(p.criado_em)) === hoje).length,
        retiradas_hoje: abertos.filter(p => p.data_retirada === hoje).length, retiradas_amanha: abertos.filter(p => p.data_retirada === amanha).length,
        sinais_pendentes: abertos.filter(p => p.valor_pago < p.valor_sinal).length, a_receber: r2(abertos.reduce((s, p) => s + Math.max(p.total - p.valor_pago, 0), 0)) };
    }
  };
  function exigirEquipe() { if (!equipe()) throw ['Acesso restrito à equipe da Rita Bolos.', '42501']; }
  const EMAILS_DEMO = { '00000000-0000-4000-8000-000000000001': 'rita@demo.com.br' };
  function listarEquipe() {
    return [...db.administradores].sort((a, b) => a.nome.localeCompare(b.nome)).map(a => ({ user_id: a.user_id, nome: a.nome, papel: a.papel, ativo: a.ativo,
      email: a.email || EMAILS_DEMO[a.user_id] || null, criado_em: a.criado_em, ultimo_acesso: a.user_id === USUARIO_DEMO.id ? agora() : null }));
  }
  Object.assign(RPC, {
    listar_equipe: () => { exigirEquipe(); return listarEquipe(); },
    definir_avatar: ({ p_avatar }) => {
      const a = db.administradores.find(x => x.user_id === usuarioId() && x.ativo) || (db.produtores_personalizados || []).find(x => x.user_id === usuarioId() && x.ativo);
      if (!a) throw 'Só a equipe pode escolher um avatar.';
      a.avatar = p_avatar || null; salvar(); return null;
    },
    salvar_produtor_personalizados: ({ p_email, p_nome, p_ativo }) => {
      if (!adminLoja()) throw ['Só a Administração pode liberar acesso.', '42501'];
      const email = String(p_email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw 'Informe um e-mail válido.';
      if (!String(p_nome || '').trim()) throw 'Informe o nome.';
      let p = db.produtores_personalizados.find(x => x.email === email);
      if (!p) { p = { user_id: novoId(), email, avatar: null, criado_em: agora() }; db.produtores_personalizados.push(p); }
      Object.assign(p, { nome: String(p_nome).trim(), ativo: p_ativo !== false });
      salvar(); return clone(p);
    },
    remover_produtor_personalizados: ({ p_user_id }) => {
      if (!adminLoja()) throw ['Só a Administração pode tirar acesso.', '42501'];
      db.produtores_personalizados = db.produtores_personalizados.filter(p => p.user_id !== p_user_id); salvar(); return null;
    },
    salvar_membro_equipe: ({ p_email, p_nome, p_papel, p_ativo }) => {
      exigirEquipe();
      const email = String(p_email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw 'Informe um e-mail válido.';
      if (!String(p_nome || '').trim()) throw 'Informe o nome.';
      if (!['admin', 'atendente'].includes(p_papel)) throw 'Papel inválido.';
      let a = db.administradores.find(x => (x.email || EMAILS_DEMO[x.user_id]) === email);
      if (a && a.user_id === USUARIO_DEMO.id && (p_papel !== 'admin' || p_ativo === false)) throw 'Você não pode tirar o seu próprio acesso de administrador.';
      if (!a) { a = { user_id: novoId(), email, criado_em: agora() }; db.administradores.push(a); }
      Object.assign(a, { nome: String(p_nome).trim(), papel: p_papel, ativo: p_ativo !== false });
      salvar(); return listarEquipe();
    },
    remover_membro_equipe: ({ p_user_id }) => {
      exigirEquipe();
      if (p_user_id === USUARIO_DEMO.id) throw 'Você não pode remover o seu próprio acesso.';
      db.administradores = db.administradores.filter(a => a.user_id !== p_user_id); salvar(); return listarEquipe();
    }
  });

  async function rpc(nome, args = {}) {
    await new Promise(r => setTimeout(r, 120));
    if (!RPC[nome]) return erro(`Função ${nome} não existe.`, 'PGRST202');
    try { return { data: clone(RPC[nome](args) ?? null), error: null }; }
    catch (e) { if (Array.isArray(e)) return erro(e[0], e[1]); if (typeof e === 'string') return erro(e); return erro(e.message || String(e), 'XX000'); }
  }

  /* ----------------------- login ----------------------- */
  const auth = {
    async signInWithPassword({ email, password }) {
      await new Promise(r => setTimeout(r, 200));
      if (!email || !password) return { data: { user: null }, error: { message: 'Invalid login credentials' } };
      // e-mail de quem produz personalizados (ex.: topos@demo.com.br) entra como essa pessoa; qualquer outro, como a Rita
      const prod = (db.produtores_personalizados || []).find(p => p.email === String(email).trim().toLowerCase());
      sessao = { user: prod ? { id: prod.user_id, email: prod.email } : { ...USUARIO_DEMO, email } };
      try { localStorage.setItem(CHAVE + '.sessao', JSON.stringify(sessao)); } catch (e) {}
      ouvintesAuth.forEach(f => f('SIGNED_IN', sessao));
      return { data: { user: sessao.user, session: sessao }, error: null };
    },
    async signOut() { sessao = null; try { localStorage.removeItem(CHAVE + '.sessao'); } catch (e) {} ouvintesAuth.forEach(f => f('SIGNED_OUT', null)); return { error: null }; },
    async getUser() { return { data: { user: sessao?.user ?? null }, error: null }; },
    async getSession() { return { data: { session: sessao }, error: null }; },
    onAuthStateChange(f) { ouvintesAuth.add(f); setTimeout(() => f(sessao ? 'INITIAL_SESSION' : 'INITIAL_SESSION', sessao), 0); return { data: { subscription: { unsubscribe: () => ouvintesAuth.delete(f) } } }; },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser() { return { data: {}, error: null }; }
  };

  /* ----------------------- fotos ----------------------- */
  const storage = {
    from() {
      return {
        getPublicUrl: path => ({ data: { publicUrl: imagens[path] || db._imagens?.[path] || prefixoImagens + path } }),
        async upload(path, arquivo) {
          const url = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(arquivo); });
          db._imagens = db._imagens || {}; db._imagens[path] = url; salvar();
          return { data: { path }, error: null };
        },
        async remove(paths) { paths.forEach(p => { if (db._imagens) delete db._imagens[p]; }); salvar(); return { data: [], error: null }; },
        async list(pasta) {
          const todos = [...new Set([...Object.keys(imagens), ...Object.keys(db._imagens || {})])];
          return { data: todos.filter(p => p.startsWith(pasta ? pasta + '/' : '')).map(p => ({ name: p.slice(pasta ? pasta.length + 1 : 0) })), error: null };
        }
      };
    }
  };

  /* ----------------------- tempo real ----------------------- */
  function channel() {
    const c = { ouvintes: [], on(_t, filtro, cb) { c.ouvintes.push([filtro?.table || null, cb]); return c; }, subscribe(f) { canais.add(c); setTimeout(() => f?.('SUBSCRIBED'), 0); return c; } };
    return c;
  }

  db = carregar();
  salvar();
  return { from, rpc, auth, storage, channel, removeChannel: c => canais.delete(c),
    _demo: { reiniciar() { localStorage.removeItem(CHAVE); db = carregar(); salvar(); } } };
}

const DEF_PRODUTO = { tipo: 'simples', unidade_preco: 'unidade', pede_observacao: false, observacao_obrigatoria: false, destaque: false, antecedencia_minima_dias: 0, ordem: 0, ativo: true };
