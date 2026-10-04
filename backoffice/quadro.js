/**
 * Quadro da equipe (TV da cozinha e do balcão)
 * ------------------------------------------------------------------
 * Pedidos em aberto por status, o que produzir hoje e amanhã e os
 * números do dia. Foi feito para ficar aberto numa TV sem ninguém mexer:
 * atualiza sozinho (tempo real + conferência periódica), troca de página
 * quando a coluna não cabe, mantém a tela acesa e avisa pedido novo.
 *
 * Endereço: backoffice/quadro.html
 *   ?demo     usa os dados de demonstração (os mesmos do backoffice ?demo)
 *   ?dias=7   quantos dias à frente aparecem nas colunas (padrão 7)
 */
import { criarApi, conectar, formatarPreco as R, formatarPeso } from '../js/rita-api.js';

const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo');
const FUSO = 'America/Sao_Paulo';
const DIAS_A_FRENTE = Math.min(60, Math.max(1, parseInt(PARAMS.get('dias'), 10) || 7));
const TROCA_PAGINA_MS = 12000;
const NOVO_MS = 3 * 60e3;          // quanto tempo um pedido novo fica destacado
const MUDOU_MS = 2600;             // destaque rápido de quem acabou de mudar de coluna
const EM_BREVE_MIN = 120;          // "em 45 min" a partir de 2 h antes da retirada
const CONFERIR_MS = 60e3;          // conferência periódica, além do tempo real
const SUPERFICIE = '#1E1510';      // fundo das colunas (as cores dos status são calculadas contra ele)
const MQ_LISTA = '(max-width: 999px) and (orientation: portrait), (max-width: 760px), (max-height: 500px)';
const CHAVE_SOM = 'ritabolos.quadro.som';

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ic = id => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

let api = null;
let STATUS = [];                   // cadastro de status
let dados = null;                  // última carga: { abertos, hoje, itens, notas }
let conhecidos = null;             // id -> status na carga anterior (para achar novos e mudanças)
const destaques = new Map();       // id -> { tipo: 'novo' | 'mudou', em }
const conexao = { tempoReal: 'conectando', ok: null, falhou: false };
const timers = [];
let pararTempoReal = null, pararAuth = null, tCarga = null, carregando = false, outraCarga = false;
let quadroAtivo = false;           // falso na tela de entrada: nada de carregar em segundo plano

/* =========================================================
   DATAS (sempre no horário de São Paulo)
========================================================= */
const fmtPartes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDataLonga = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long' });
const fmtSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long' });
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const maiuscula = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Agora em São Paulo: data ISO, "HH:MM" e minutos corridos (para comparar com a retirada). */
function agora() {
  const p = Object.fromEntries(fmtPartes.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, min: Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) / 6e4 };
}
const somarDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10); };
const hora = p => (p.hora_retirada ? String(p.hora_retirada).slice(0, 5) : '');
/** Minutos corridos da retirada; sem horário, conta como fim do dia. */
function minRetirada(p) {
  const [a, m, d] = String(p.data_retirada).split('-').map(Number);
  const [h, mi] = p.hora_retirada ? String(p.hora_retirada).split(':').map(Number) : [23, 59];
  return Date.UTC(a, m - 1, d, h, mi) / 6e4;
}
function rotuloDia(iso, hoje) {
  if (iso === hoje) return 'Hoje';
  if (iso === somarDias(hoje, 1)) return 'Amanhã';
  if (iso === somarDias(hoje, -1)) return 'Ontem';
  const [a, m, d] = iso.split('-').map(Number);
  return `${SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}
const dataCurta = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
function duracao(min) {
  min = Math.round(Math.abs(min));
  if (min < 60) return `${min} min`;
  if (min < 1440) { const h = Math.floor(min / 60), r = min % 60; return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`; }
  return plural(Math.floor(min / 1440), 'dia', 'dias');
}
function nomeCurto(nome) {
  const p = String(nome || '').trim().split(/\s+/);
  return p.length <= 2 ? p.join(' ') : `${p[0]} ${p[p.length - 1]}`;
}
const primeiroNome = nome => String(nome || '').trim().split(/\s+/)[0] || 'Cliente';

/* =========================================================
   CORES DOS STATUS
   As cores do cadastro foram pensadas para fundo claro. Aqui elas vão
   para uma faixa legível no fundo escuro, mantendo o tom de cada uma, e
   status vizinhos são afastados em claro/escuro para não se confundirem
   (inclusive para quem é daltônico: simulação de Machado et al., 2009).
========================================================= */
const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hexRgb(hex) {
  const h = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())?.[1] || '8A8A8A', n = parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map(v => lin(v / 255));
}
function rgbLab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labRgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const CVD = [[[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],   // protan
             [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]]];     // deutan
const simular = (M, c) => M.map(r => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2])));
const distLab = (a, b) => { const x = rgbLab(a), y = rgbLab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100; };
const luminancia = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const NIVEIS_L = Array.from({ length: 17 }, (_, i) => 0.5 + i * 0.01);   // OKLCH L de 0,50 a 0,66
const FUNDO_RGB = hexRgb(SUPERFICIE);
function montarCor(L, C, h) {   // reduz o croma até caber no sRGB
  let c = C, rgb = labRgb([L, c * Math.cos(h), c * Math.sin(h)]);
  while (rgb.some(v => v < 0 || v > 1) && c > 0.01) { c -= 0.004; rgb = labRgb([L, c * Math.cos(h), c * Math.sin(h)]); }
  return rgb.map(v => Math.min(1, Math.max(0, v)));
}
/** 1 = separados o bastante para todo mundo; abaixo disso, se confundem. */
const separacao = (a, b) => Math.min(Math.min(...CVD.map(M => distLab(simular(M, a), simular(M, b)))) / 9, distLab(a, b) / 16);
function paletaTela(hexes) {
  const cs = hexes.map(hex => {
    const [L, A, B] = rgbLab(hexRgb(hex)), C = Math.hypot(A, B);
    return { L0: L, C: C >= 0.035 ? Math.max(C, 0.12) : C, h: Math.atan2(B, A) };   // cinza continua cinza
  });
  const ls = cs.map(c => c.L0), lo = Math.min(...ls), hi = Math.max(...ls);
  cs.forEach(c => {   // começa da ordem claro/escuro original, esticada para a faixa legível
    c.alvo = hi - lo < 0.01 ? 0.58 : 0.5 + (c.L0 - lo) / (hi - lo) * 0.16;
    c.L = NIVEIS_L.reduce((m, n) => (Math.abs(n - c.alvo) < Math.abs(m - c.alvo) ? n : m));
  });
  const pior = () => {   // [vizinhos, vizinho do vizinho (ficam lado a lado quando o do meio está vazio)]
    const r = cs.map(c => montarCor(c.L, c.C, c.h)); let a = Infinity, b = Infinity;
    for (let i = 0; i < r.length - 1; i++) a = Math.min(a, separacao(r[i], r[i + 1]));
    for (let i = 0; i < r.length - 2; i++) b = Math.min(b, separacao(r[i], r[i + 2]));
    return [Math.min(a, 1.2), Math.min(b, 1.2)];
  };
  for (let volta = 0; volta < 6; volta++) for (const c of cs) {
    let melhor = c.L, nota = [-1, -1], desvio = Infinity;
    for (const n of NIVEIS_L) {
      if (contraste(montarCor(n, c.C, c.h), FUNDO_RGB) < 3.05) continue;
      c.L = n;
      const [a, b] = pior(), d = Math.abs(n - c.alvo);
      if (a > nota[0] + 1e-9 || (Math.abs(a - nota[0]) < 1e-9 && (b > nota[1] + 1e-9 || (Math.abs(b - nota[1]) < 1e-9 && d < desvio)))) { melhor = n; nota = [a, b]; desvio = d; }
    }
    c.L = melhor;
  }
  return cs.map(c => montarCor(c.L, c.C, c.h));
}
let cacheCores = { chave: '', mapa: new Map() };
/** codigo -> { hex, rgb: "r, g, b", texto } para cada status, na ordem do cadastro. */
function coresStatus(lista) {
  const chave = lista.map(s => `${s.codigo}:${s.cor}`).join('|');
  if (chave === cacheCores.chave) return cacheCores.mapa;
  const cancel = lista.filter(s => s.codigo === 'cancelado'), resto = lista.filter(s => s.codigo !== 'cancelado');
  const rgbs = [...paletaTela(resto.map(s => s.cor)), ...cancel.map(s => montarCor(0.58, 0, 0))];
  const mapa = new Map();
  [...resto, ...cancel].forEach((s, i) => {
    const srgb = rgbs[i].map(v => Math.round(gam(v) * 255));
    mapa.set(s.codigo, {
      hex: '#' + srgb.map(v => v.toString(16).padStart(2, '0')).join(''), rgb: srgb.join(', '),
      texto: contraste(rgbs[i], [1, 1, 1]) >= contraste(rgbs[i], hexRgb('#1A110C')) ? '#FFFFFF' : '#1A110C'
    });
  });
  cacheCores = { chave, mapa };
  return mapa;
}

/* =========================================================
   ETAPAS
   Colunas = status ativos e não finalizados, na ordem do cadastro.
   "Pronto" é o último antes de finalizar; produção é o que fica entre
   o primeiro (aguardando sinal) e o pronto.
========================================================= */
function etapas() {
  const cols = STATUS.filter(s => s.ativo !== false && !s.finalizado).sort((a, b) => a.ordem - b.ordem);
  for (const p of dados?.abertos || []) {   // pedido com status desativado ganha coluna própria
    if (!cols.some(s => s.codigo === p.status)) cols.push({ codigo: p.status, nome: p.status_nome || p.status, cor: p.status_cor || '#8A8A8A', ordem: p.status_ordem ?? 999, descricao: '' });
  }
  if (!cols.length) return { cols, pronto: null, inicial: null, producao: new Set() };
  const pronto = cols.find(s => s.codigo === 'pronto') || cols[cols.length - 1];
  const inicial = cols.find(s => s.codigo === 'recebido') || cols[0];
  let prod = cols.filter(s => s.ordem < pronto.ordem && s !== inicial);
  if (!prod.length) prod = cols.filter(s => s.ordem < pronto.ordem);
  return { cols, pronto, inicial, producao: new Set(prod.map(s => s.codigo)) };
}
const ordemDe = p => STATUS.find(s => s.codigo === p.status)?.ordem ?? p.status_ordem ?? 0;

/* =========================================================
   CARGA DOS DADOS
========================================================= */
async function criarCliente() {
  if (DEMO) {
    const { criarSupabaseDemo } = await import('../demo/supabase-demo.js');
    return criarApi(criarSupabaseDemo({ prefixoImagens: new URL('../imagens/', location.href).href }));
  }
  const cfg = await import('../js/config.js');
  return conectar(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY);
}
const lotes = (lista, n = 80) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
/** Itens de vários pedidos de uma vez. null = não deu (os cartões usam o resumo do pedido). */
async function carregarItens(ids) {
  const mapa = new Map();
  if (!ids.length) return mapa;
  try {
    const partes = await Promise.all(lotes(ids).map(l => api.admin.pedidos.itens.listar({ filtros: { pedido_id: l }, ordenarPor: [['pedido_id', true], ['ordem', true]] })));
    for (const it of partes.flat()) { if (!mapa.has(it.pedido_id)) mapa.set(it.pedido_id, []); mapa.get(it.pedido_id).push(it); }
    return mapa;
  } catch (e) { console.warn('Itens indisponíveis; usando o resumo de cada pedido.', e); return null; }
}
/** Observações internas fixadas (ex.: alergia, caixa alta): aparecem no cartão. */
async function carregarNotas(ids) {
  const mapa = new Map();
  if (!ids.length) return mapa;
  try {
    const respostas = await Promise.all(lotes(ids).map(l => api.supabase.from('pedido_observacoes').select('pedido_id, texto').eq('fixada', true).in('pedido_id', l)));
    for (const { data, error } of respostas) {
      if (error) throw error;
      for (const o of data) { if (!mapa.has(o.pedido_id)) mapa.set(o.pedido_id, []); mapa.get(o.pedido_id).push(o.texto); }
    }
  } catch (e) { console.warn('Observações fixadas indisponíveis.', e); }
  return mapa;
}
async function carregar() {
  if (!api || !quadroAtivo) return;
  if (carregando) { outraCarga = true; return; }
  carregando = true; clearTimeout(tCarga);
  try {
    const hoje = agora().iso;
    const [status, abertos, doDia, categorias] = await Promise.all([
      api.admin.status.listar(),
      api.admin.pedidos.listar({ apenasAbertos: true, porPagina: 500 }),
      api.admin.pedidos.listar({ de: hoje, ate: hoje, porPagina: 300 }),
      api.admin.categorias.listar().catch(() => [])
    ]);
    const ate = somarDias(hoje, DIAS_A_FRENTE - 1);
    const ids = abertos.pedidos.filter(p => p.data_retirada <= ate).map(p => p.id);
    const [itens, notas] = await Promise.all([carregarItens(ids), carregarNotas(ids)]);
    STATUS = status;
    acharNovidades(abertos.pedidos);
    dados = { abertos: abertos.pedidos, hoje: doDia.pedidos, itens, notas, ordemCat: new Map(categorias.map((c, i) => [c.nome, i])) };
    conexao.ok = new Date(); conexao.falhou = false;
    if (!$('#painel')) montarQuadro();   // voltou depois de uma falha na primeira carga
    desenhar();
  } catch (e) {
    console.error(e);
    if (await sessaoAcabou(e)) return;
    conexao.falhou = true;
    if (dados) desenharConexao(); else telaFalha(e?.message);
  } finally {
    carregando = false;
    if (outraCarga) { outraCarga = false; carregar(); }
    else if (quadroAtivo) tCarga = setTimeout(carregar, conexao.falhou ? 15e3 : CONFERIR_MS);
  }
}
let tPedido = null;
const pedirCarga = () => { clearTimeout(tPedido); tPedido = setTimeout(carregar, 600); };

async function sessaoAcabou(e) {
  if (DEMO || !/sess|permiss|jwt|equipe/i.test(e?.message || '')) return false;
  const perfil = await api.auth.perfil().catch(() => null);
  if (perfil) return false;
  telaEntrada('Sua sessão terminou. Entre de novo para o quadro voltar a atualizar.');
  return true;
}

/** Compara com a carga anterior: pedido novo ganha destaque e aviso; quem mudou de coluna pisca. */
function acharNovidades(lista) {
  const t = Date.now(), novos = [];
  if (conhecidos) {
    for (const p of lista) {
      if (!conhecidos.has(p.id)) {
        const recente = t - new Date(p.criado_em).getTime() < 15 * 60e3;   // reaberto (ex.: retirada desfeita) não é pedido novo
        destaques.set(p.id, { tipo: recente ? 'novo' : 'mudou', em: t });
        if (recente) novos.push(p);
      } else if (conhecidos.get(p.id) !== p.status) destaques.set(p.id, { tipo: 'mudou', em: t });
    }
  }
  conhecidos = new Map(lista.map(p => [p.id, p.status]));
  for (const [id, d] of destaques) if (t - d.em > (d.tipo === 'novo' ? NOVO_MS : MUDOU_MS)) destaques.delete(id);
  if (novos.length) avisarNovos(novos);
}

/* =========================================================
   DESENHO
========================================================= */
function montarQuadro() {
  app.innerHTML = `<div class="quadro">
    <header class="topo">
      <div class="marca"><img src="logo.png" alt="" width="80" height="80"><div><strong>Rita Bolos</strong><span>Quadro da equipe</span></div></div>
      <section class="kpis" id="kpis" aria-label="Números do dia"></section>
      <div class="agora"><div class="data" id="data"></div><div class="hora" id="hora" aria-live="off"></div><div class="conexao" id="conexao"></div></div>
    </header>
    <div class="faixa-erro" id="faixaErro" role="status" hidden></div>
    <main class="painel" id="painel" aria-label="Pedidos por status"></main>
  </div>
  <div class="novidade" id="novidade" role="status" aria-live="polite"></div>
  <div class="controles" role="toolbar" aria-label="Controles do quadro">
    <button type="button" data-ctl="som" aria-pressed="${somLigado()}">${ic(somLigado() ? 'som' : 'mudo')}<span>${somLigado() ? 'Som ligado' : 'Som desligado'}</span></button>
    <button type="button" data-ctl="tela">${ic('tela')}<span>Tela cheia</span></button>
    <a href="./${DEMO ? '?demo' : ''}">${ic('voltar')}<span>Backoffice</span></a>
  </div>`;
  atualizarRelogio();
}

function desenhar() {
  if (!dados || !$('#painel')) return;
  const ag = agora(), E = etapas(), cores = coresStatus(STATUS.slice().sort((a, b) => a.ordem - b.ordem));
  E.cols.forEach(s => { if (!cores.has(s.codigo)) cores.set(s.codigo, { hex: s.cor, rgb: hexRgb(s.cor).map(v => Math.round(gam(v) * 255)).join(', '), texto: '#FFFFFF' }); });
  const ctx = { ag, E, cores, estaPronto: p => !!E.pronto && ordemDe(p) >= E.pronto.ordem };
  $('#kpis').innerHTML = kpis(ctx);
  const painel = $('#painel');
  painel.style.setProperty('--colunas', E.cols.length || 1);
  // TV na vertical: status em duas colunas, com mais altura que a produção
  painel.style.setProperty('--linhas-vertical', `repeat(${Math.ceil((E.cols.length || 1) / 2)}, minmax(0, 1.45fr)) minmax(0, 1fr)`);
  painel.innerHTML = E.cols.map(s => coluna(s, ctx)).join('') + producao(ctx);
  ajustarRotulosBarra();
  desenharConexao();
  paginar();
}

/* ---------- Números do dia ---------- */
function kpis(ctx) {
  const { ag, E, cores } = ctx;
  const doDia = dados.hoje.filter(p => p.status !== 'cancelado');
  const prontos = doDia.filter(p => ctx.estaPronto(p) || p.finalizado).length;
  const contagem = new Map();
  doDia.forEach(p => contagem.set(p.status, (contagem.get(p.status) || 0) + 1));
  // do mais adiantado para o menos: a barra enche da esquerda para a direita
  const segs = STATUS.filter(s => contagem.get(s.codigo)).sort((a, b) => b.ordem - a.ordem)
    .map(s => ({ s, n: contagem.get(s.codigo), cor: cores.get(s.codigo) }));
  const barra = doDia.length
    ? `<div class="barra" role="img" aria-label="${esc(segs.map(x => `${x.s.nome}: ${x.n}`).join(', '))}">${segs.map(x => `<span class="seg" style="flex:${x.n} 1 0;background:${x.cor.hex};color:${x.cor.texto}" title="${esc(x.s.nome)}: ${x.n}"><b>${x.n}</b></span>`).join('')}</div>
       <div class="legenda">${segs.map(x => `<span><i style="background:${x.cor.hex}"></i>${esc(x.s.nome)}<b>${x.n}</b></span>`).join('')}</div>`
    : `<div class="barra"></div><div class="legenda"><span>Nenhuma retirada marcada para hoje</span></div>`;

  const naoProntos = dados.abertos.filter(p => !ctx.estaPronto(p));
  const atrasados = naoProntos.filter(p => minRetirada(p) < ag.min).sort((a, b) => minRetirada(a) - minRetirada(b));
  const logo = naoProntos.filter(p => p.hora_retirada && minRetirada(p) >= ag.min && minRetirada(p) - ag.min <= EM_BREVE_MIN).sort((a, b) => minRetirada(a) - minRetirada(b));
  const amanha = somarDias(ag.iso, 1);
  const deAmanha = dados.abertos.filter(p => p.data_retirada === amanha);
  const semSinal = deAmanha.filter(p => p.status === E.inicial?.codigo && !p.sinal_pago).length;
  const quem = (lista) => lista.length ? esc(`${primeiroNome(lista[0].cliente_nome)} ${hora(lista[0]) || dataCurta(lista[0].data_retirada)}`) + (lista.length > 1 ? ` +${lista.length - 1}` : '') : '';

  return `<div class="kpi kpi-hoje">
      <div class="kpi-cab"><span class="kpi-rot">Retiradas de hoje</span><span class="kpi-meta">${doDia.length ? `${prontos} de ${doDia.length} prontos ou entregues` : 'Dia livre'}</span></div>
      <div class="kpi-val">${doDia.length}</div>
      <div class="hoje-graf">${barra}</div>
    </div>
    <div class="kpi ${atrasados.length ? 'critico' : 'bom'}">
      <span class="kpi-ic">${ic(atrasados.length ? 'alerta' : 'ok')}</span>
      <div><div class="kpi-rot">Atrasados</div><div class="kpi-val">${atrasados.length}</div>
        <div class="kpi-sub">${atrasados.length ? quem(atrasados) : 'Nenhum atraso'}</div></div>
    </div>
    <div class="kpi ${logo.length ? 'aviso' : ''}">
      <span class="kpi-ic">${ic('relogio')}</span>
      <div><div class="kpi-rot">Próximas 2 horas</div><div class="kpi-val">${logo.length}</div>
        <div class="kpi-sub">${logo.length ? quem(logo) : 'Nada por agora'}</div></div>
    </div>
    <div class="kpi">
      <span class="kpi-ic">${ic('calendario')}</span>
      <div><div class="kpi-rot">Para amanhã</div><div class="kpi-val">${deAmanha.length}</div>
        <div class="kpi-sub">${!deAmanha.length ? 'Nenhum pedido' : semSinal ? `${semSinal} sem sinal` : 'Todos com sinal'}</div></div>
    </div>`;
}
/** Número dentro do segmento só quando cabe com folga; senão a legenda mostra. */
function ajustarRotulosBarra() {
  $$('.seg').forEach(seg => {
    const b = seg.firstElementChild; if (!b) return;
    b.hidden = false;   // mede visível; escondido a largura seria zero
    b.hidden = b.scrollWidth + 8 > seg.clientWidth;
  });
}

/* ---------- Colunas ---------- */
function coluna(s, ctx) {
  const { ag } = ctx, cor = ctx.cores.get(s.codigo);
  const ate = somarDias(ag.iso, DIAS_A_FRENTE - 1);
  const todos = dados.abertos.filter(p => p.status === s.codigo).sort((a, b) => minRetirada(a) - minRetirada(b) || String(a.codigo).localeCompare(b.codigo));
  const visiveis = todos.filter(p => p.data_retirada <= ate), depois = todos.length - visiveis.length;
  const ehPronto = s.codigo === ctx.E.pronto?.codigo;
  const atrasados = visiveis.filter(p => minRetirada(p) < ag.min).length;
  const hoje = visiveis.filter(p => p.data_retirada === ag.iso && minRetirada(p) >= ag.min).length;
  const amanha = visiveis.filter(p => p.data_retirada === somarDias(ag.iso, 1)).length;
  const resumo = [
    atrasados ? (ehPronto ? `<em>${plural(atrasados, 'passou do horário', 'passaram do horário')}</em>` : `<b>${plural(atrasados, 'atrasado', 'atrasados')}</b>`) : '',
    hoje ? `${hoje} para hoje` : '', amanha ? `${amanha} amanhã` : ''
  ].filter(Boolean).join(' · ') || esc(s.descricao || '');
  const id = 'col-' + s.codigo;
  return `<section class="coluna" style="--cor:${cor.hex};--cor-rgb:${cor.rgb}" aria-labelledby="${id}">
    <div class="col-topo">
      <h2 class="col-nome" id="${id}" style="margin:0"><i aria-hidden="true"></i><span>${esc(s.nome)}</span></h2>
      <span class="col-qtd" aria-label="${plural(todos.length, 'pedido', 'pedidos')}">${todos.length}</span>
      <div class="col-resumo">${resumo || '&nbsp;'}</div>
    </div>
    <div class="rolo" data-pag="${esc(s.codigo)}"><div class="trilho">${visiveis.length ? visiveis.map(p => cartao(p, ctx)).join('') : vazio(ehPronto)}</div></div>
    <div class="col-pe">${depois ? `<span>+${depois} depois de ${dataCurta(ate)}</span>` : ''}<span class="pag" data-ind="${esc(s.codigo)}" hidden></span></div>
  </section>`;
}
function vazio(ehPronto) {
  return `<div class="vazio">${ic(ehPronto ? 'ok' : 'bolo')}<span>${ehPronto ? 'Nenhum pedido esperando retirada' : 'Nada por aqui agora'}</span></div>`;
}

/* ---------- Cartão do pedido ---------- */
const ficha = (tipo, icone, texto) => `<span class="ficha ${tipo}">${ic(icone)}${esc(texto)}</span>`;
function cartao(p, ctx) {
  const { ag } = ctx, falta = minRetirada(p) - ag.min, pronto = ctx.estaPronto(p), dia = rotuloDia(p.data_retirada, ag.iso);
  let classe = '', urgencia = '';
  if (falta < 0) {
    if (pronto) { classe = 'esperando'; urgencia = ficha('aviso', 'relogio', p.hora_retirada ? `Esperando há ${duracao(falta)}` : `Era para ${dia.toLowerCase()}`); }
    else { classe = 'atrasado'; urgencia = ficha('critico', 'alerta', p.hora_retirada ? `Atrasado ${duracao(falta)}` : `Era para ${dia.toLowerCase()}`); }
  } else if (!pronto && p.hora_retirada && falta <= EM_BREVE_MIN) {
    classe = 'em-breve'; urgencia = ficha('aviso', 'relogio', `Retira em ${duracao(falta)}`);
  }
  const d = destaques.get(p.id);
  const novo = d?.tipo === 'novo' ? ficha('marca', 'brilho', 'Novo') : '';
  // o atraso negativo continua a animação de onde parou quando o quadro é redesenhado
  const anim = d ? ` style="animation-delay:-${Date.now() - d.em}ms"` : '';
  const notas = dados.notas.get(p.id) || [];
  const pagto = pagamento(p, ctx);
  return `<article class="cartao ${classe} ${d ? d.tipo : ''}"${anim} aria-label="${esc(`${p.codigo}, ${p.cliente_nome}, retirada ${dia.toLowerCase()}${hora(p) ? ' às ' + hora(p) : ''}`)}">
    <div class="c-cab">
      <div class="c-quando">${hora(p) ? `<span class="c-hora">${hora(p)}</span>` : '<span class="c-hora sem">Sem hora</span>'}<span class="c-dia">${esc(dia)}</span></div>
      <div class="c-quem"><span class="c-nome" title="${esc(p.cliente_nome)}">${esc(nomeCurto(p.cliente_nome))}</span><span class="c-cod">${esc(p.codigo)}</span></div>
    </div>
    ${urgencia || novo ? `<div class="c-fichas">${novo}${urgencia}</div>` : ''}
    <ul class="c-itens">${itensDoCartao(p)}</ul>
    ${notas.map(n => `<div class="c-nota">${ic('pin')}<span>${esc(n)}</span></div>`).join('')}
    ${p.observacao_cliente ? `<div class="c-obs">${ic('conversa')}<span>${esc(p.observacao_cliente)}</span></div>` : ''}
    ${pagto ? `<div class="c-pag">${pagto}</div>` : ''}
  </article>`;
}
function detalheItem(i) {
  return [i.massa, i.formato, i.segundo_recheio ? `2º recheio: ${i.segundo_recheio}` : ''].filter(Boolean).join(' · ');
}
function itensDoCartao(p) {
  const itens = dados.itens ? dados.itens.get(p.id) : null;
  if (!itens) return `<li class="c-item"><span class="c-qtd"></span><span class="c-prod">${esc(p.resumo_itens || 'Itens do pedido')}</span></li>`;
  const MAX = 4, mostrar = itens.length > MAX ? itens.slice(0, MAX - 1) : itens;
  return mostrar.map(i => {
    const det = detalheItem(i);
    return `<li class="c-item"><span class="c-qtd">${i.quantidade}×</span><span>
      <span class="c-prod">${esc(i.nome)}${i.peso_kg ? ` <span class="c-peso">${esc(formatarPeso(i.peso_kg))}</span>` : ''}</span>
      ${det ? `<span class="c-det">${esc(det)}</span>` : ''}${i.observacao ? `<span class="c-iobs">${esc(i.observacao)}</span>` : ''}</span></li>`;
  }).join('') + (itens.length > mostrar.length ? `<li class="c-mais">+ ${plural(itens.length - mostrar.length, 'item', 'itens')}</li>` : '');
}
/** Dinheiro só onde importa: sinal no começo, saldo no pronto (para quem entrega). */
function pagamento(p, ctx) {
  const n = v => R(v).replace(/ /g, ' ');
  if (p.status === ctx.E.inicial?.codigo && !p.sinal_pago) return ficha('', 'moeda', `Aguardando sinal de ${n(Math.max(0, p.valor_sinal - p.valor_pago))}`);
  if (ctx.estaPronto(p)) return Number(p.saldo) > 0 ? ficha('', 'moeda', `Receber ${n(p.saldo)} na retirada`) : ficha('bom', 'ok', 'Tudo pago');
  return '';
}

/* ---------- Produção: o que fazer hoje e amanhã ---------- */
function producao(ctx) {
  const { ag, E } = ctx, amanha = somarDias(ag.iso, 1);
  const dias = [
    { nome: 'Hoje', data: ag.iso, filtro: p => p.data_retirada <= ag.iso },   // atrasados entram no hoje
    { nome: 'Amanhã', data: amanha, filtro: p => p.data_retirada === amanha }
  ];
  let corpo;
  if (!dados.itens) corpo = '<div class="vazio">Não foi possível carregar os itens agora.</div>';
  else {
    const blocos = dias.map(dia => {
      const pedidos = dados.abertos.filter(p => E.producao.has(p.status) && dia.filtro(p));
      const semSinal = dados.abertos.filter(p => p.status === E.inicial?.codigo && !E.producao.has(p.status) && dia.filtro(p)).length;
      const linhas = new Map();
      for (const p of pedidos) for (const i of dados.itens.get(p.id) || []) {
        const det = detalheItem(i), chave = [i.categoria, i.nome, i.peso_kg, det, i.observacao].join('|');
        const l = linhas.get(chave) || { cat: i.categoria || '', nome: i.nome, peso: i.peso_kg, det, obs: i.observacao, qtd: 0 };
        l.qtd += Number(i.quantidade) || 0; linhas.set(chave, l);
      }
      const porCat = new Map(), ordemCat = c => dados.ordemCat.get(c) ?? 999;   // mesma ordem do cardápio
      [...linhas.values()].sort((a, b) => ordemCat(a.cat) - ordemCat(b.cat) || a.cat.localeCompare(b.cat, 'pt-BR') || b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR'))
        .forEach(l => { if (!porCat.has(l.cat)) porCat.set(l.cat, []); porCat.get(l.cat).push(l); });
      const cats = [...porCat.entries()].map(([cat, ls]) => `${porCat.size > 1 && cat ? `<div class="p-cat">${esc(cat)}</div>` : ''}${ls.map(l => `<div class="p-linha">
          <span class="p-qtd">${l.qtd}<small>×</small></span>
          <span class="p-nome">${esc(l.nome)}${l.peso ? ` · ${esc(formatarPeso(l.peso))}` : ''}${l.det ? `<span class="p-det">${esc(l.det)}</span>` : ''}${l.obs ? `<span class="p-obs">${esc(l.obs)}</span>` : ''}</span>
        </div>`).join('')}`).join('');
      return `<div class="p-dia">
        <div class="p-dia-cab"><strong>${dia.nome}</strong><span>${esc(maiuscula(fmtSemana.format(new Date(dia.data + 'T12:00:00Z'))))} ${dataCurta(dia.data)} · ${plural(pedidos.length, 'pedido', 'pedidos')}</span></div>
        ${cats || `<div class="p-nota">${dia.nome === 'Hoje' ? 'Nada para produzir hoje.' : 'Nada confirmado para amanhã ainda.'}</div>`}
        ${semSinal ? `<div class="p-nota"><b>+ ${plural(semSinal, 'pedido', 'pedidos')}</b> aguardando sinal (fora da lista)</div>` : ''}
      </div>`;
    });
    corpo = blocos.join('');
  }
  const nomes = [...E.producao].map(c => STATUS.find(s => s.codigo === c)?.nome || c);
  return `<aside class="producao" aria-labelledby="prodTit">
    <div class="col-topo">
      <h2 class="col-nome" id="prodTit" style="margin:0"><span>Produção</span></h2>
      <span></span>
      <div class="prod-sub">${nomes.length ? esc(nomes.join(' e ')) : 'Pedidos em andamento'}, somados por item</div>
    </div>
    <div class="rolo" data-pag="producao"><div class="trilho">${corpo}</div></div>
    <div class="col-pe"><span class="pag" data-ind="producao" hidden></span></div>
  </aside>`;
}

/* =========================================================
   PAGINAÇÃO AUTOMÁTICA
   Coluna que não cabe na tela troca de página sozinha, sempre em
   cartões inteiros, todas no mesmo compasso.
========================================================= */
const paginas = new Map();         // chave -> { i, inicios }
let inicioCiclo = Date.now();
function paginar() {
  const lista = matchMedia(MQ_LISTA).matches;
  for (const rolo of $$('[data-pag]')) {
    const chave = rolo.dataset.pag, trilho = rolo.firstElementChild;
    const est = paginas.get(chave) || { i: 0, inicios: [0] };
    paginas.set(chave, est);
    const inicios = [0];
    if (!lista) {
      const H = rolo.clientHeight; let base = 0;
      for (const f of trilho.children) if (f.offsetTop > base && f.offsetTop + f.offsetHeight - base > H + 1) { inicios.push(f.offsetTop); base = f.offsetTop; }
    }
    est.inicios = inicios;
    if (est.i >= inicios.length) est.i = 0;
    mostrarPagina(rolo, est, false);
  }
}
function mostrarPagina(rolo, est, animar) {
  const trilho = rolo.firstElementChild, ini = est.inicios[est.i], fim = ini + rolo.clientHeight, varias = est.inicios.length > 1;
  if (!animar) trilho.style.transition = 'none';
  trilho.style.transform = ini ? `translateY(${-ini}px)` : '';
  for (const f of trilho.children) {
    const topo = f.offsetTop, baixo = topo + f.offsetHeight;
    f.classList.toggle('fora', varias && (topo < ini - 1 || (baixo > fim + 1 && topo > ini + 1)));
  }
  if (!animar) { void trilho.offsetHeight; trilho.style.transition = ''; }
  const ind = $(`[data-ind="${CSS.escape(rolo.dataset.pag)}"]`);
  if (!ind) return;
  ind.hidden = !varias;
  if (!varias) return;
  ind.innerHTML = `<span aria-label="Página ${est.i + 1} de ${est.inicios.length}">${est.i + 1} de ${est.inicios.length}</span><span class="pag-barra" aria-hidden="true"><i></i></span>`;
  const barra = ind.querySelector('i');
  if (barra.animate) {
    const a = barra.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: TROCA_PAGINA_MS, easing: 'linear', fill: 'forwards' });
    a.currentTime = Math.min(TROCA_PAGINA_MS, Date.now() - inicioCiclo);
  }
}
function virarPaginas() {
  inicioCiclo = Date.now();
  for (const rolo of $$('[data-pag]')) {
    const est = paginas.get(rolo.dataset.pag);
    if (!est || est.inicios.length < 2) continue;
    est.i = (est.i + 1) % est.inicios.length;
    mostrarPagina(rolo, est, true);
  }
}

/* =========================================================
   RELÓGIO, CONEXÃO E AVISOS
========================================================= */
function atualizarRelogio() {
  const h = $('#hora'), d = $('#data');
  if (!h) return;
  h.textContent = agora().hora;
  d.textContent = maiuscula(fmtDataLonga.format(new Date()));
}
function desenharConexao() {
  const el = $('#conexao'), faixa = $('#faixaErro');
  if (!el) return;
  const quando = conexao.ok ? conexao.ok.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }) : '';
  const vivo = conexao.tempoReal === 'SUBSCRIBED' || conexao.tempoReal === 'demo';
  const [classe, texto] = conexao.falhou ? ['fora', 'Sem conexão'] : vivo ? ['vivo', 'Ao vivo'] : ['lento', 'Atualiza a cada minuto'];
  el.className = 'conexao ' + classe;
  el.innerHTML = `<i aria-hidden="true"></i><strong>${texto}</strong>${quando ? `· ${quando}` : ''}${DEMO ? '<span class="selo-demo">Demo</span>' : ''}`;
  faixa.hidden = !conexao.falhou;
  if (conexao.falhou) faixa.innerHTML = `${ic('sem-sinal')}<span>Não foi possível atualizar. Mostrando os pedidos de ${quando}; tentando de novo a cada 15 segundos.</span>`;
}
let tAviso = null;
function avisarNovos(novos) {
  tocarAviso();
  const el = $('#novidade'); if (!el) return;
  const p = novos[0], ag = agora();
  const titulo = novos.length === 1 ? `Novo pedido de ${primeiroNome(p.cliente_nome)}` : `${novos.length} pedidos novos`;
  const sub = novos.length === 1
    ? `Retirada ${rotuloDia(p.data_retirada, ag.iso).toLowerCase()}${hora(p) ? ' às ' + hora(p) : ''} · ${p.codigo}`
    : novos.map(x => primeiroNome(x.cliente_nome)).join(', ');
  el.innerHTML = `<span class="novidade-ic">${ic('brilho')}</span><div class="novidade-txt"><strong>${esc(titulo)}</strong><span>${esc(sub)}</span></div>`;
  el.classList.add('on');
  clearTimeout(tAviso); tAviso = setTimeout(() => el.classList.remove('on'), 9000);
}

/* Som de pedido novo: o navegador só libera áudio depois do primeiro toque/tecla na página. */
let audio = null;
const somLigado = () => { try { return localStorage.getItem(CHAVE_SOM) !== 'off'; } catch (e) { return true; } };
function liberarSom() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch (e) { audio = null; }
}
function tocarAviso() {
  if (!somLigado() || !audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  [[659.25, 0], [880, 0.15], [1318.5, 0.3]].forEach(([f, dt]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + dt);
    g.gain.exponentialRampToValueAtTime(0.22, t + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.9);
    o.connect(g); g.connect(audio.destination); o.start(t + dt); o.stop(t + dt + 1);
  });
}

/* Tela sempre acesa (onde o navegador permite) */
let travaTela = null;
async function manterAcesa() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !travaTela) { travaTela = await navigator.wakeLock.request('screen'); travaTela.addEventListener('release', () => { travaTela = null; }); } } catch (e) { travaTela = null; }
}

/* Cursor e controles somem quando ninguém mexe */
let tOcioso = null;
function mexeu() {
  document.body.classList.remove('ocioso');
  clearTimeout(tOcioso); tOcioso = setTimeout(() => document.body.classList.add('ocioso'), 3500);
}
function alternarTelaCheia() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ctl]'); if (!b) return;
  if (b.dataset.ctl === 'tela') alternarTelaCheia();
  if (b.dataset.ctl === 'som') {
    const ligar = !somLigado();
    try { localStorage.setItem(CHAVE_SOM, ligar ? 'on' : 'off'); } catch (e) { /* fica só nesta sessão */ }
    b.setAttribute('aria-pressed', String(ligar));
    b.innerHTML = `${ic(ligar ? 'som' : 'mudo')}<span>${ligar ? 'Som ligado' : 'Som desligado'}</span>`;
    if (ligar) { liberarSom(); tocarAviso(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'f' || e.key === 'F') alternarTelaCheia();
});
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, liberarSom, { passive: true });
for (const ev of ['mousemove', 'pointerdown', 'keydown', 'touchstart']) addEventListener(ev, mexeu, { passive: true });
document.addEventListener('fullscreenchange', () => {
  const b = $('[data-ctl="tela"] span'); if (b) b.textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && api && dados) { manterAcesa(); carregar(); } });
addEventListener('online', () => { if (api && dados) carregar(); });
let tResize = null;
addEventListener('resize', () => { clearTimeout(tResize); tResize = setTimeout(() => { ajustarRotulosBarra(); paginar(); }, 200); });

/* =========================================================
   TELAS: entrada, falha e quadro
========================================================= */
function pararTudo() {
  quadroAtivo = false;
  timers.splice(0).forEach(clearInterval);
  clearTimeout(tCarga); clearTimeout(tPedido);
  pararTempoReal?.(); pararTempoReal = null;
}
function telaEntrada(aviso = '') {
  pararTudo(); dados = null; conhecidos = null;
  document.body.classList.remove('ocioso');
  app.innerHTML = `<div class="entrada"><form class="entrada-card" id="fEntrar" novalidate>
    <img src="logo.png" alt="Rita Bolos" width="140" height="140">
    <h1>Quadro da equipe</h1>
    <p>Entre com a sua conta da equipe. Depois é só deixar esta tela aberta na TV: ela se atualiza sozinha.</p>
    <div class="entrada-erro" id="eErro" role="alert" ${aviso ? '' : 'hidden'}>${esc(aviso)}</div>
    <label>E-mail<input id="eEmail" type="email" autocomplete="username" inputmode="email" required></label>
    <label>Senha<input id="eSenha" type="password" autocomplete="current-password" required></label>
    <button type="submit">Entrar e abrir o quadro</button>
    ${DEMO ? '<p class="entrada-demo">Demonstração: entre com qualquer e-mail e senha.</p>' : ''}
  </form></div>`;
  setTimeout(() => $('#eEmail')?.focus(), 50);
  $('#fEntrar').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || $('#fEntrar button'), erro = $('#eErro');
    btn.disabled = true; erro.hidden = true;
    try {
      await api.auth.entrar($('#eEmail').value.trim(), $('#eSenha').value);
      if (!await api.auth.perfil()) { await api.auth.sair().catch(() => {}); throw new Error('Esta conta não faz parte da equipe.'); }
      abrirQuadro();
    } catch (err) { erro.textContent = err.message || 'Não deu para entrar.'; erro.hidden = false; btn.disabled = false; }
  });
}
function telaFalha(msg) {
  app.innerHTML = `<div class="entrada"><div class="entrada-card"><img src="logo.png" alt="Rita Bolos" width="140" height="140">
    <h1>Sem conexão</h1><p>${esc(msg || 'Não foi possível falar com o servidor.')}</p><p>Tentando de novo em instantes…</p></div></div>`;
}
function iniciarTempoReal() {
  pararTempoReal?.();
  conexao.tempoReal = DEMO ? 'demo' : 'conectando';
  try {
    pararTempoReal = api.admin.pedidos.aoMudar(() => pedirCarga(), estado => {
      const voltou = estado === 'SUBSCRIBED' && conexao.tempoReal !== 'SUBSCRIBED';
      conexao.tempoReal = estado; desenharConexao();
      if (voltou && dados) pedirCarga();   // reconectou: confere o que mudou enquanto estava fora
    });
  } catch (e) { conexao.tempoReal = 'indisponivel'; }
}
function abrirQuadro() {
  pararTudo();
  quadroAtivo = true;
  montarQuadro();
  iniciarTempoReal();
  carregar();
  timers.push(setInterval(atualizarRelogio, 5e3));
  timers.push(setInterval(desenhar, 30e3));               // atrasos e "em 45 min" andam com o relógio
  timers.push(setInterval(virarPaginas, TROCA_PAGINA_MS));
  manterAcesa(); mexeu();
  document.fonts?.ready.then(() => { ajustarRotulosBarra(); paginar(); });
}

async function iniciar() {
  try { api = await criarCliente(); } catch (e) { telaFalha(e.message); return; }
  pararAuth?.();
  pararAuth = api.auth.aoMudar(evento => { if (evento === 'SIGNED_OUT' && dados) telaEntrada('Você saiu da conta. Entre de novo para ver o quadro.'); });
  const perfil = await api.auth.perfil().catch(() => null);
  if (perfil) { abrirQuadro(); return; }
  const usuario = await api.auth.usuario().catch(() => null);
  telaEntrada(usuario ? 'Esta conta não faz parte da equipe.' : '');
}

/* Na demonstração os dados ficam no navegador: quando o backoffice (outra aba) muda algo, recarrega. */
if (DEMO) {
  let tDemo = null;
  addEventListener('storage', e => {
    if (!e.key?.startsWith('ritabolos.demo') || !dados) return;
    clearTimeout(tDemo);
    tDemo = setTimeout(async () => { api = await criarCliente(); iniciarTempoReal(); carregar(); }, 250);
  });
}

iniciar();
