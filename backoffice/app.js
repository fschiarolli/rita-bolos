/**
 * Backoffice Rita Bolos
 * ------------------------------------------------------------------
 * Pedidos (status, observações, pagamentos, recibo), cardápio e ajustes.
 * Usa a mesma API do site (../js/rita-api.js).
 * Modo demonstração, sem banco: abra com ?demo
 */
import { criarApi, conectar, formatarPreco as R, formatarPeso, formatarData, linkRecibo, linkWhatsApp, abrirWhatsApp, linkCompartilhavel, montarMensagemStatus, prepararAba,
  separarReferencia, juntarReferencia, ehTopper, PIX } from '../js/rita-api.js';
import { AVATARES, avatarSVG, temAvatar } from './avatares.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const FUSO = 'America/Sao_Paulo';
const LOGO = window.__RITA_LOGO__ || 'logo.png';
const RAIZ_SITE = new URL('../', location.href).href;   // onde ficam index.html e recibo.html

let api = null;
let perfil = null;
let STATUS = [];
let telaAtual = null;          // 'painel' | 'pedidos' | 'cardapio' | 'ajustes'
let rotaAtual = '';
let pararTempoReal = null;

const app = document.getElementById('app');

/* =========================================================
   UTILIDADES
========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ic = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const isAdmin = () => perfil?.papel === 'admin';
const hojeISO = (dias = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(Date.now() + dias * 864e5));
const hora = t => (t ? String(t).slice(0, 5) : '');
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function dataCurta(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()];
  if (iso === hojeISO()) return 'Hoje';
  if (iso === hojeISO(1)) return 'Amanhã';
  return `${dia}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}
const dataHora = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
function lerValor(s) {
  s = String(s ?? '').trim().replace(/^R\$\s*/, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const valorTxt = n => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function corTexto(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#2A1A12' : '#fff';
}
/** "r, g, b" de uma cor #rrggbb (para tingir fundos com transparência). */
function rgbDe(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '110, 75, 58';
  const n = parseInt(m[1], 16);
  return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
}
/** Cor do cadastro como variáveis CSS: --c (ponto/ícone) e --c-rgb (fundo tingido). */
const corVars = cor => `--c:${esc(cor || '#6E4B3A')};--c-rgb:${rgbDe(cor)}`;
const pill = (nome, cor) => `<span class="pill" style="${corVars(cor)}">${esc(nome)}</span>`;
const statusDe = c => STATUS.find(s => s.codigo === c) || { codigo: c, nome: c, cor: '#6E4B3A' };
/* ---- Telefone com máscara: (DD) 9999-9999 ou (DD) 99999-9999 ---- */
/** Só os dígitos do telefone, sem o 55 do Brasil (no máximo DDD + 9 dígitos). */
function digitosTel(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d.replace(/^0+/, '').slice(0, 11);
}
function formatarTel(v) {
  const d = digitosTel(v);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const n = d.slice(2), corte = n.length > 8 ? 5 : 4;   // 9 dígitos: celular
  return `(${d.slice(0, 2)}) ${n.length > corte ? n.slice(0, corte) + '-' + n.slice(corte) : n}`;
}
/** Vazio é aceito (telefone opcional); preenchido precisa ter DDD + 8 ou 9 dígitos. */
const telOk = v => { const n = digitosTel(v).length; return n === 0 || n === 10 || n === 11; };
const ATTR_TEL = 'type="tel" inputmode="tel" data-tel maxlength="16" placeholder="(19) 99999-9999" autocomplete="off"';
/* Aplica a máscara enquanto digita (ou cola), sem tirar o cursor do lugar */
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.matches?.('input[data-tel]')) return;
  const pos = el.selectionStart ?? el.value.length;
  const antes = el.value.slice(0, pos).replace(/\D/g, '').length;
  const novo = formatarTel(el.value);
  if (novo === el.value) return;
  el.value = novo;
  let i = 0, vistos = 0;
  while (i < novo.length && vistos < antes) { if (/\d/.test(novo[i])) vistos++; i++; }
  if (document.activeElement === el) el.setSelectionRange(i, i);
});
function telefoneWa(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = '55' + d.replace(/^0+/, '');
  return d;
}
const ORIGENS = { site: 'Site', backoffice: 'Backoffice', whatsapp: 'WhatsApp', balcao: 'Balcão' };
const FORMAS = { pix: 'Pix', dinheiro: 'Dinheiro', cartao_debito: 'Cartão de débito', cartao_credito: 'Cartão de crédito', transferencia: 'Transferência', outro: 'Outro' };
const TIPOS_PGTO = { sinal: 'Sinal', restante: 'Restante', outro: 'Outro' };
const urlReciboInterno = (id, imprimir) => `${RAIZ_SITE}recibo.html?id=${encodeURIComponent(id)}${imprimir ? '&imprimir' : ''}${DEMO ? '&demo' : ''}`;
const urlSite = () => `${RAIZ_SITE}index.html${DEMO ? '?demo' : ''}`;
const urlQuadro = () => `quadro.html${DEMO ? '?demo' : ''}`;
const urlPote = () => `${RAIZ_SITE}bolo-no-pote.html${DEMO ? '?demo' : ''}`;   // página só de bolo no pote, para mandar aos clientes

/* =========================================================
   AVISOS (toasts), MODAIS E CONFIRMAÇÃO
========================================================= */
function toast(msg, { tipo = '', acao = null, tempo = 4200 } = {}) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  t.innerHTML = `<span>${esc(msg)}</span>${acao ? `<button type="button" class="acao">${esc(acao.rotulo)}</button>` : ''}`;
  if (acao) t.querySelector('.acao').addEventListener('click', () => { t.remove(); acao.fn(); });
  box.appendChild(t);
  setTimeout(() => t.remove(), acao ? Math.max(tempo, 8000) : tempo);
}
const erroToast = e => { console.error(e); toast(e?.message || 'Algo deu errado. Tente de novo.', { tipo: 'erro', tempo: 6500 }); };

const pilhaModais = [];
function abrirModal({ titulo, corpo, rodape = '', largo = false, aoAbrir }) {
  const veu = document.createElement('div');
  veu.className = 'modal-veu';
  veu.innerHTML = `<div class="modal ${largo ? 'largo' : ''}" role="dialog" aria-modal="true" aria-labelledby="mt${pilhaModais.length}">
    <div class="modal-h"><h2 id="mt${pilhaModais.length}">${esc(titulo)}</h2>
      <button type="button" class="btn icon sm ghost" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="modal-b">${corpo}</div>
    ${rodape ? `<div class="modal-f">${rodape}</div>` : ''}</div>`;
  const anterior = document.activeElement;
  document.body.appendChild(veu);
  const m = {
    el: veu,
    $: s => veu.querySelector(s),
    $$: s => [...veu.querySelectorAll(s)],
    fechar() {
      const i = pilhaModais.indexOf(m); if (i >= 0) pilhaModais.splice(i, 1);
      veu.remove();
      if (anterior && document.contains(anterior)) anterior.focus();
    }
  };
  pilhaModais.push(m);
  veu.addEventListener('mousedown', e => { if (e.target === veu) m.fechar(); });
  veu.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) m.fechar(); });
  setTimeout(() => {
    if (veu.contains(document.activeElement)) return;   // a pessoa já está digitando em algum campo
    const alvo = veu.querySelector('[autofocus]') || veu.querySelector('.modal-b input:not([type=hidden]):not([readonly]), .modal-b select, .modal-b textarea') || veu.querySelector('.modal-f .primary') || veu.querySelector('[data-fechar]');
    alvo?.focus();
  }, 40);
  aoAbrir?.(m);
  return m;
}
function confirmar(titulo, texto, { botao = 'Confirmar', perigo = false } = {}) {
  return new Promise(ok => {
    let resposta = false;
    const m = abrirModal({
      titulo,
      corpo: `<p style="margin:0;font-weight:400;line-height:1.5">${esc(texto)}</p>`,
      rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn ${perigo ? 'danger' : 'primary'}" data-sim autofocus>${esc(botao)}</button>`
    });
    m.$('[data-sim]').addEventListener('click', () => { resposta = true; m.fechar(); });
    const obs = new MutationObserver(() => { if (!document.contains(m.el)) { obs.disconnect(); ok(resposta); } });
    obs.observe(document.body, { childList: true });
  });
}
/** Executa uma ação mostrando "carregando" no botão e avisando se der erro. */
async function ocupado(btn, fn) {
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); }
  catch (e) { erroToast(e); return undefined; }
  finally { if (btn && document.contains(btn)) { btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (pilhaModais.length) { pilhaModais[pilhaModais.length - 1].fechar(); return; }
  if ($('#gaveta')?.classList.contains('on')) fecharGaveta();
});

/* Campos de formulário (atalhos para os modais de cadastro) */
const campo = (id, rot, html, dica = '') => `<div class="field"><label for="${id}">${rot}</label>${html}${dica ? `<p class="dica">${dica}</p>` : ''}</div>`;
const inTxt = (id, rot, val = '', o = {}) => campo(id, rot, `<input class="in" id="${id}" value="${esc(val ?? '')}" ${o.attrs || ''}>`, o.dica);
const inNum = (id, rot, val = '', o = {}) => campo(id, rot, `<input class="in" id="${id}" type="number" inputmode="numeric" value="${esc(val ?? '')}" ${o.attrs || ''}>`, o.dica);
const inDin = (id, rot, val = '', o = {}) => campo(id, rot, `<div class="money"><input class="in" id="${id}" inputmode="decimal" value="${esc(valorTxt(val))}" ${o.attrs || ''}></div>`, o.dica);
const inTa = (id, rot, val = '', o = {}) => campo(id, rot, `<textarea class="ta" id="${id}" ${o.attrs || ''}>${esc(val ?? '')}</textarea>`, o.dica);
const inSel = (id, rot, opcoes, val, o = {}) => campo(id, rot, `<select class="sel" id="${id}" ${o.attrs || ''}>${opcoes.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`, o.dica);
const inChk = (id, rot, marcado) => `<label class="chk"><input type="checkbox" id="${id}" ${marcado ? 'checked' : ''}>${rot}</label>`;
const valDe = (m, id) => m.$('#' + id)?.value.trim() ?? '';
const numDe = (m, id) => { const v = valDe(m, id); return v === '' ? null : Number(v); };
const chkDe = (m, id) => !!m.$('#' + id)?.checked;
function exigir(m, id, msg) {
  const el = m.$('#' + id);
  if (el && !el.value.trim()) { el.setAttribute('aria-invalid', 'true'); el.focus(); throw new Error(msg); }
  el?.removeAttribute('aria-invalid');
}

/* Foto: reduz para no máximo 1400 px (fotos de celular ficam bem menores) */
async function prepararFoto(arquivo) {
  if (!arquivo || !/^image\//.test(arquivo.type)) throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WEBP).');
  if (/svg|gif/.test(arquivo.type)) return arquivo;
  try {
    const bmp = await createImageBitmap(arquivo);
    const escala = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    if (escala === 1 && arquivo.size < 600 * 1024) return arquivo;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise(ok => c.toBlob(ok, 'image/webp', 0.85));
    let ext = 'webp';
    if (!blob || blob.type !== 'image/webp') { blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.86)); ext = 'jpg'; }
    const nome = (arquivo.name || 'foto').replace(/\.[a-z0-9]+$/i, '') + '.' + ext;
    return new File([blob], nome, { type: blob.type });
  } catch (e) {
    if (arquivo.size > 5 * 1024 * 1024) throw new Error('A foto passa de 5 MB. Escolha uma imagem menor.');
    return arquivo;
  }
}
/** Bloco de foto com pré-visualização, "Trocar foto" e "Remover". Guarda o caminho em data-path. */
function fotoCampo(id, rotulo, path) {
  const url = path ? api.urlImagem(path) : null;
  return `<div class="field"><span class="lbl">${esc(rotulo)}</span>
    <div class="foto-campo" id="${id}" data-path="${esc(path || '')}">
      <div class="prev">${url ? `<img src="${esc(url)}" alt="">` : 'Sem foto'}</div>
      <div class="bt"><label class="btn sm ghost" style="cursor:pointer">${ic('foto')}<span>${url ? 'Trocar foto' : 'Enviar foto'}</span>
        <input type="file" accept="image/*" class="sr" data-foto-input></label>
        <button type="button" class="btn sm ghost" data-foto-remover ${url ? '' : 'hidden'}>${ic('lixo')}Remover</button></div>
    </div></div>`;
}
function ligarFotos(m, pasta) {
  m.$$('.foto-campo').forEach(box => {
    const input = box.querySelector('[data-foto-input]');
    const rot = input.closest('label').querySelector('span');
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      rot.textContent = 'Enviando…';
      try {
        const pronto = await prepararFoto(f);
        const { path, url } = await api.admin.imagens.enviar(pronto, pasta);
        box.dataset.path = path;
        box.querySelector('.prev').innerHTML = `<img src="${esc(url)}" alt="">`;
        box.querySelector('[data-foto-remover]').hidden = false;
        rot.textContent = 'Trocar foto';
      } catch (e) { erroToast(e); rot.textContent = box.dataset.path ? 'Trocar foto' : 'Enviar foto'; }
      input.value = '';
    });
    box.querySelector('[data-foto-remover]').addEventListener('click', () => {
      box.dataset.path = '';
      box.querySelector('.prev').textContent = 'Sem foto';
      box.querySelector('[data-foto-remover]').hidden = true;
      rot.textContent = 'Enviar foto';
    });
  });
}
const fotoDe = (m, id) => m.$('#' + id)?.dataset.path || null;

/* Aviso sonoro de pedido novo */
let audio = null;
function tocarAviso() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    [[880, 0], [1175, 0.16]].forEach(([f, d]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.18, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.3);
      o.connect(g).connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + 0.32);
    });
  } catch (e) { /* sem som neste navegador */ }
}

/* =========================================================
   CONEXÃO E LOGIN
========================================================= */
async function iniciarApi() {
  if (DEMO) {
    const { criarSupabaseDemo } = await import('../demo/supabase-demo.js');
    return criarApi(criarSupabaseDemo({ prefixoImagens: RAIZ_SITE + 'imagens/' }));
  }
  const cfg = await import('../js/config.js');
  return conectar(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY);
}

function telaErroConexao(msg) {
  app.innerHTML = `<div class="login"><div class="login-card"><img src="${esc(LOGO)}" alt="Rita Bolos">
    <h1 class="display">Sem conexão</h1><p class="sub">${esc(msg)}</p>
    <button type="button" class="btn primary block" onclick="location.reload()">Tentar de novo</button></div></div>`;
}

function telaLogin(aviso = '') {
  telaAtual = null; rotaAtual = '';
  app.innerHTML = `<div class="login"><div class="login-card">
    <img src="${esc(LOGO)}" alt="Rita Bolos">
    <h1 class="display">Rita Bolos</h1><p class="sub">Backoffice</p>
    <form id="fLogin" novalidate>
      ${campo('lEmail', 'E-mail', '<input class="in" id="lEmail" type="email" autocomplete="username" inputmode="email" required>')}
      ${campo('lSenha', 'Senha', '<input class="in" id="lSenha" type="password" autocomplete="current-password" required>')}
      <p class="err-msg" id="lErro" role="alert" ${aviso ? '' : 'hidden'}>${esc(aviso)}</p>
      <button type="submit" class="btn primary block">Entrar</button>
      <p style="text-align:center;margin:14px 0 0"><button type="button" class="link" id="lEsqueci">Esqueci minha senha</button></p>
    </form>
    ${DEMO ? '<div class="demo-note">Modo demonstração: entre com qualquer e-mail e senha. Tudo fica salvo só neste navegador.</div>' : ''}
  </div></div>`;
  const erro = msg => { const p = $('#lErro'); p.textContent = msg; p.hidden = !msg; };
  $('#fLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#lEmail').value.trim(), senha = $('#lSenha').value;
    if (!email || !senha) { erro('Preencha e-mail e senha.'); return; }
    erro('');
    await ocupado(e.submitter || $('#fLogin button[type=submit]'), async () => {
      try { await api.auth.entrar(email, senha); }
      catch (err) { erro(err.message); return; }
      await aposLogin();
    });
  });
  $('#lEsqueci').addEventListener('click', async () => {
    const email = $('#lEmail').value.trim();
    if (!email) { erro('Digite seu e-mail acima e toque de novo em “Esqueci minha senha”.'); $('#lEmail').focus(); return; }
    await ocupado($('#lEsqueci'), async () => {
      await api.auth.enviarRedefinicaoSenha(email, location.href.split('#')[0]);
      erro(''); toast('Se o e-mail estiver cadastrado, chega um link para criar uma nova senha.', { tempo: 7000 });
    });
  });
  setTimeout(() => $('#lEmail')?.focus(), 50);
}

async function aposLogin() {
  perfil = await api.auth.perfil();
  if (!perfil) {
    await api.auth.sair().catch(() => {});
    telaLogin('Esta conta não tem acesso ao backoffice. Peça para a administradora liberar o seu e-mail em Ajustes > Equipe.');
    return;
  }
  try { STATUS = await api.admin.status.listar(); } catch (e) { STATUS = []; }
  telaShell();
  ligarTempoReal();
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#painel');
  rotear(true);
  atualizarBadge();
}

function modalNovaSenha(titulo = 'Criar nova senha') {
  const m = abrirModal({
    titulo,
    corpo: `${campo('ns1', 'Nova senha', '<input class="in" id="ns1" type="password" autocomplete="new-password" minlength="8">', 'Use pelo menos 8 caracteres.')}
      ${campo('ns2', 'Repita a nova senha', '<input class="in" id="ns2" type="password" autocomplete="new-password">')}`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-salvar>Salvar senha</button>`
  });
  m.$('[data-salvar]').addEventListener('click', e => ocupado(e.currentTarget, async () => {
    const a = valDe(m, 'ns1'), b = valDe(m, 'ns2');
    if (a.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
    if (a !== b) throw new Error('As duas senhas não são iguais.');
    await api.auth.trocarSenha(a);
    m.fechar(); toast('Senha alterada.');
  }));
}

/* =========================================================
   ESTRUTURA (menu lateral, barra inferior no celular)
========================================================= */
const NAV = [
  { id: 'painel', rot: 'Painel', ic: 'painel' },
  { id: 'hoje', rot: 'Hoje', ic: 'hoje' },
  { id: 'pedidos', rot: 'Pedidos', ic: 'pedidos', badge: true },
  { id: 'relatorio', rot: 'Relatório', ic: 'grafico', admin: true },
  { id: 'prejuizos', rot: 'Prejuízos', ic: 'alerta', admin: true },
  { id: 'cardapio', rot: 'Cardápio', ic: 'bolo', admin: true },
  { id: 'ajustes', rot: 'Ajustes', ic: 'config', admin: true }
];
const iniciais = nome => String(nome || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

/* ---- Avatar do perfil: personagem escolhido (backoffice/avatares.js) ou as iniciais ---- */
// Sem o sql/avatar-perfil.sql rodado, a escolha fica guardada só neste aparelho
const AVATAR_LOCAL = id => 'ritabolos.avatar.' + id;
const avatarDe = pessoa => {
  let a = pessoa?.avatar;
  if (a === undefined && pessoa?.user_id) { try { a = localStorage.getItem(AVATAR_LOCAL(pessoa.user_id)); } catch (e) { a = null; } }
  return a && temAvatar(a) ? a : null;
};
function avatarHTML(pessoa, attrs = '') {
  const a = avatarDe(pessoa);
  return a ? `<span class="avatar av-img" ${attrs}>${avatarSVG(a)}</span>` : `<span class="avatar" ${attrs}>${esc(iniciais(pessoa?.nome))}</span>`;
}
/** Redesenha o avatar da pessoa logada onde ele aparece (menu, topo, Minha conta). */
function atualizarMeuAvatar() {
  $$('[data-eu]').forEach(el => {
    const novo = document.createElement('div');
    novo.innerHTML = avatarHTML(perfil, [...el.attributes].filter(at => at.name !== 'class').map(at => `${at.name}="${esc(at.value)}"`).join(' '));
    el.replaceWith(novo.firstElementChild);
  });
}
function modalAvatar() {
  let escolhido = avatarDe(perfil) || '';
  const opcao = id => `<button type="button" class="av-op" role="radio" aria-checked="${id === escolhido}" data-av="${id}" aria-label="Personagem ${Number(id.slice(1))}">${avatarSVG(id)}</button>`;
  const m = abrirModal({
    titulo: 'Escolha seu avatar',
    largo: true,
    corpo: `<div class="av-topo"><span class="av-prev">${avatarHTML({ ...perfil, avatar: escolhido })}</span>
        <div style="flex:1;min-width:0"><strong>${esc(perfil.nome)}</strong><small>Aparece no menu, no topo e para a equipe.</small></div>
        <button type="button" class="btn ghost sm" data-av="" aria-checked="${!escolhido}">Usar as iniciais</button></div>
      <div class="av-grade" role="radiogroup" aria-label="Avatares">${AVATARES.map(a => opcao(a.id)).join('')}</div>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Usar este avatar</button>`
  });
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-av]'); if (!b) return;
    escolhido = b.dataset.av;
    m.$$('[data-av]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    m.$('.av-prev').innerHTML = avatarHTML({ ...perfil, avatar: escolhido });
  });
  m.el.addEventListener('dblclick', e => { if (e.target.closest('[data-av]')) m.$('[data-ok]').click(); });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    let soAqui = false;
    try { await api.auth.definirAvatar(escolhido || null); }
    catch (e) {
      // banco ainda sem a coluna/função (sql/avatar-perfil.sql): guarda neste aparelho
      if (!/PGRST202|42883|42703|definir_avatar|function|função/i.test(`${e?.codigo} ${e?.message}`)) throw e;
      soAqui = true;
    }
    try { if (escolhido) localStorage.setItem(AVATAR_LOCAL(perfil.user_id), escolhido); else localStorage.removeItem(AVATAR_LOCAL(perfil.user_id)); } catch (e) { /* sem armazenamento */ }
    if (soAqui) delete perfil.avatar; else perfil.avatar = escolhido || null;
    m.fechar();
    atualizarMeuAvatar();
    toast(soAqui ? 'Avatar salvo neste aparelho. Para valer em todos, rode sql/avatar-perfil.sql no Supabase.' : 'Avatar atualizado.', soAqui ? { tempo: 8000 } : {});
  }));
}
const papelTxt = () => (perfil.papel === 'admin' ? 'Administração' : 'Atendimento');
function telaShell() {
  const itens = NAV.filter(n => !n.admin || isAdmin());
  const link = (n, cls) => `<a class="${cls}" href="#${n.id}" data-nav="${n.id}">${ic(n.ic)}<span>${n.rot}</span>${n.badge ? '<span class="nav-badge" data-badge hidden></span>' : ''}</a>`;
  const principais = itens.filter(n => !n.admin), gestao = itens.filter(n => n.admin);
  app.innerHTML = `<div class="shell">
    <aside class="side" aria-label="Menu principal">
      <a class="brand" href="#painel"><img src="${esc(LOGO)}" alt=""><div><strong>Rita Bolos</strong><span>Backoffice${DEMO ? ' · demo' : ''}</span></div></a>
      <nav class="side-nav">
        <p class="side-sec">Principal</p>${principais.map(n => link(n, 'nav-a')).join('')}
        ${gestao.length ? `<p class="side-sec">Gestão</p>${gestao.map(n => link(n, 'nav-a')).join('')}` : ''}
        <p class="side-sec">Atalhos</p>
        <a class="nav-a" href="${esc(urlQuadro())}" target="_blank" rel="noopener">${ic('tv')}<span>Quadro da equipe</span>${ic('externo', 'ic ext')}</a>
        <a class="nav-a" href="${esc(urlSite())}" target="_blank" rel="noopener">${ic('externo')}<span>Ver o site</span>${ic('externo', 'ic ext')}</a>
        <a class="nav-a" href="${esc(urlPote())}" target="_blank" rel="noopener">${ic('pote')}<span>Página do bolo no pote</span>${ic('externo', 'ic ext')}</a>
      </nav>
      <div class="side-foot">
        <button type="button" class="user-card" data-act="conta" aria-label="Minha conta">${avatarHTML(perfil, 'aria-hidden="true" data-eu')}
          <span class="uc-t"><strong>${esc(perfil.nome)}</strong><small>${papelTxt()}${perfil.email ? ' · ' + esc(perfil.email) : ''}</small></span></button>
        <button type="button" class="btn icon sm ghost" data-act="sair" aria-label="Sair da conta" title="Sair">${ic('sair')}</button>
      </div>
    </aside>
    <div class="coluna">
      <header class="topo">
        <a class="topo-marca" href="#painel"><img src="${esc(LOGO)}" alt="">Rita Bolos${DEMO ? '<small>demo</small>' : ''}</a>
        <form class="topo-busca" id="topoBusca" role="search">${ic('busca')}<label class="sr" for="topoBuscaIn">Buscar pedido</label>
          <input id="topoBuscaIn" type="search" placeholder="Buscar pedido: nome, telefone ou código" autocomplete="off"><kbd aria-hidden="true">/</kbd></form>
        <div class="topo-acts">
          <button type="button" class="topo-bt" data-act="tema" aria-haspopup="menu" aria-expanded="false">${ic(temaDe(temaAtual()).icone)}</button>
          <a class="topo-bt" data-tv href="${esc(urlQuadro())}" target="_blank" rel="noopener" aria-label="Abrir o quadro da equipe (TV)" title="Quadro da equipe (TV)">${ic('tv')}</a>
          <button type="button" class="topo-av" data-act="conta" aria-label="Minha conta" title="${esc(perfil.nome)}">${avatarHTML(perfil, 'data-eu')}</button>
        </div>
      </header>
      <main class="conteudo" id="conteudo" tabindex="-1"></main>
      <footer class="rodape"><span>© ${new Date().getFullYear()} Rita Bolos · Backoffice${DEMO ? ' (demonstração)' : ''}</span>
        <span><a href="${esc(urlSite())}" target="_blank" rel="noopener">Site</a><a href="${esc(urlQuadro())}" target="_blank" rel="noopener">Quadro da equipe</a></span></footer>
    </div>
    <nav class="nav-mob" aria-label="Menu principal">${itens.map(n => link(n, '')).join('')}</nav>
  </div>
  <div class="veu" id="veu"></div>
  <aside class="gaveta" id="gaveta" role="dialog" aria-modal="true" aria-labelledby="gavTitulo" inert></aside>`;
  $('#veu').addEventListener('click', () => fecharGaveta());
  atualizarBotaoTema();
  $('#topoBusca').addEventListener('submit', e => {
    e.preventDefault();
    const termo = $('#topoBuscaIn').value.trim(); if (!termo) return;
    Object.assign(filtro, { busca: termo, status: 'todos', periodo: 'todas', extra: null });
    $('#topoBuscaIn').value = ''; $('#topoBuscaIn').blur();
    if (telaAtual === 'pedidos' && rotaAtual === 'pedidos') telaPedidos($('#conteudo')); else location.hash = '#pedidos';
  });
}

/* Tema claro/escuro: sem escolha segue o sistema; a escolha fica salva neste aparelho */
/* ---- Temas: Automático (segue o aparelho), Claro, Escuro e Morango ----
   As cores ficam no index.html (:root[data-theme="..."]). Para criar outro: um bloco de cores lá e uma linha aqui. */
const TEMAS = [
  { id: 'auto', nome: 'Automático', desc: 'Claro ou escuro, como o aparelho', attr: null },
  { id: 'claro', nome: 'Claro', desc: 'Creme e chocolate', attr: 'light', meta: '#F8F2EA', icone: 'sol', amostra: ['#F8F2EA', '#FFFFFF', '#4A2A1C', '#2B7465'] },
  { id: 'escuro', nome: 'Escuro', desc: 'Para pouca luz', attr: 'dark', meta: '#120B08', icone: 'lua', amostra: ['#120B08', '#1C130F', '#F2DCC6', '#8FD3BF'] },
  { id: 'morango', nome: 'Morango', desc: 'Rosa suave e framboesa', attr: 'morango', meta: '#FCF0F3', icone: 'morango', amostra: ['#FCF0F3', '#FFFFFF', '#A8345C', '#2B7465'] }
];
const temaDe = id => TEMAS.find(t => t.id === id) || TEMAS[0];
const temaEscolhido = () => { try { const t = localStorage.getItem('ritabolos.tema'); return TEMAS.some(x => x.id === t) ? t : 'auto'; } catch (e) { return 'auto'; } };
/** Tema em uso agora: o automático vira claro ou escuro conforme o aparelho. */
const temaAtual = () => { const t = temaEscolhido(); return t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro') : t; };
const amostraTema = t => t.id === 'auto' ? '<span class="tema-amostra auto" aria-hidden="true"></span>'
  : `<span class="tema-amostra" aria-hidden="true" style="--a:${t.amostra[0]};--b:${t.amostra[1]};--c:${t.amostra[2]};--d:${t.amostra[3]}"></span>`;
function aplicarTema(id) {
  const t = temaDe(id);
  if (t.attr) document.documentElement.setAttribute('data-theme', t.attr); else document.documentElement.removeAttribute('data-theme');
  try { if (t.attr) localStorage.setItem('ritabolos.tema', t.id); else localStorage.removeItem('ritabolos.tema'); } catch (e) { /* só nesta visita */ }
  atualizarBotaoTema();
}
function atualizarBotaoTema() {
  const atual = temaDe(temaAtual()), escolhido = temaDe(temaEscolhido());
  $('meta[name="theme-color"]')?.setAttribute('content', atual.meta);
  $$('[data-act="tema"]').forEach(b => {
    b.innerHTML = ic(atual.icone);
    b.title = `Tema: ${escolhido.nome}`;
    b.setAttribute('aria-label', `Trocar o tema (agora: ${escolhido.nome})`);
  });
  $$('[data-tema]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.tema === escolhido.id)));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', atualizarBotaoTema);

/* Menu de temas do botão da barra superior */
function fecharMenuTema(devolverFoco) {
  const menu = $('#temaMenu'); if (!menu) return;
  menu.remove();
  const b = $('.topo [data-act="tema"]'); b?.setAttribute('aria-expanded', 'false');
  if (devolverFoco) b?.focus();
}
function abrirMenuTema(botao) {
  if ($('#temaMenu')) { fecharMenuTema(true); return; }
  const menu = document.createElement('div');
  menu.id = 'temaMenu'; menu.className = 'tema-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Tema');
  menu.innerHTML = `<p class="tema-menu-t" aria-hidden="true">Tema</p>${TEMAS.map(t => `<button type="button" role="menuitemradio" aria-checked="${t.id === temaEscolhido()}" data-tema="${t.id}">
      ${amostraTema(t)}<span><strong>${esc(t.nome)}</strong><small>${esc(t.desc)}</small></span>${ic('ok')}</button>`).join('')}`;
  document.body.appendChild(menu);
  posicionarMenuTema();
  botao.setAttribute('aria-haspopup', 'menu'); botao.setAttribute('aria-expanded', 'true');
  (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button')).focus();
}
/** Abaixo do botão, alinhado à direita (refeito se a janela mudar de tamanho: no celular a barra do navegador some ao rolar). */
function posicionarMenuTema() {
  const menu = $('#temaMenu'), b = $('.topo [data-act="tema"]'); if (!menu || !b) return;
  const r = b.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
}
document.addEventListener('click', e => {
  const op = e.target.closest('[data-tema]');
  if (op) { aplicarTema(op.dataset.tema); if (op.closest('#temaMenu')) fecharMenuTema(true); return; }
  if ($('#temaMenu') && !e.target.closest('#temaMenu, [data-act="tema"]')) fecharMenuTema();
});
document.addEventListener('keydown', e => {
  const menu = $('#temaMenu'); if (!menu) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharMenuTema(true); return; }
  if (e.key === 'Tab') { fecharMenuTema(); return; }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    const ops = $$('button', menu), i = ops.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? ops.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + ops.length) % ops.length;
    e.preventDefault(); ops[n].focus();
  }
}, true);
addEventListener('resize', posicionarMenuTema);
/* "/" leva para a busca da barra superior */
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]') || pilhaModais.length) return;
  const b = $('#topoBuscaIn'); if (!b || !b.offsetParent) return;
  e.preventDefault(); b.focus();
});

function modalConta() {
  const m = abrirModal({
    titulo: 'Minha conta',
    corpo: `<div class="user-box" style="display:flex;align-items:center;gap:12px;margin-bottom:18px"><button type="button" class="av-trocar" data-trocar-avatar aria-label="Trocar avatar" title="Trocar avatar">${avatarHTML(perfil, 'style="width:52px;height:52px;font-size:18px" data-eu')}<span class="av-lapis" aria-hidden="true">${ic('editar')}</span></button>
        <div style="min-width:0"><strong>${esc(perfil.nome)}</strong><small>${papelTxt()}${perfil.email ? ' · ' + esc(perfil.email) : ''}</small></div></div>
      <div style="display:grid;gap:10px">
        <div><p class="secao-t" style="margin:0 0 8px" id="lblTema">Tema</p>
          <div class="tema-grade" role="radiogroup" aria-labelledby="lblTema">${TEMAS.map(t => `<button type="button" class="tema-op" role="radio" aria-checked="${t.id === temaEscolhido()}" data-tema="${t.id}" title="${esc(t.desc)}">${amostraTema(t)}${esc(t.nome)}</button>`).join('')}</div></div>
        <a class="btn ghost block" href="${esc(urlSite())}" target="_blank" rel="noopener">${ic('externo')}Abrir o site</a>
        <div style="display:flex;gap:8px"><a class="btn ghost" style="flex:1" href="${esc(urlPote())}" target="_blank" rel="noopener">${ic('pote')}Página do bolo no pote</a>
          <button type="button" class="btn ghost" data-copiar-pote aria-label="Copiar o link da página do bolo no pote" title="Copiar link">${ic('copiar')}</button></div>
        <a class="btn ghost block" href="${esc(urlQuadro())}" target="_blank" rel="noopener">${ic('tv')}Quadro da equipe (TV)</a>
        ${DEMO ? `<button type="button" class="btn ghost block" data-reiniciar>${ic('atualizar')}Recomeçar a demonstração</button>` : `<button type="button" class="btn ghost block" data-senha>Trocar senha</button>`}
        <button type="button" class="btn danger block" data-sair>${ic('sair')}Sair</button>
      </div>`
  });
  m.$('[data-trocar-avatar]').addEventListener('click', () => { m.fechar(); modalAvatar(); });
  m.$('[data-copiar-pote]').addEventListener('click', async () => {
    const url = new URL(urlPote(), location.href).href;
    try { await navigator.clipboard.writeText(url); toast('Link da página do bolo no pote copiado. É só colar para o cliente.'); }
    catch (e) { prompt('Copie o link da página do bolo no pote:', url); }
  });
  m.$('[data-senha]')?.addEventListener('click', () => { m.fechar(); modalNovaSenha('Trocar senha'); });
  m.$('[data-reiniciar]')?.addEventListener('click', async () => {
    if (!await confirmar('Recomeçar a demonstração?', 'Os pedidos e mudanças feitos aqui serão apagados e os dados de exemplo voltam ao original.', { botao: 'Recomeçar', perigo: true })) return;
    api.supabase._demo?.reiniciar(); location.reload();
  });
  m.$('[data-sair]').addEventListener('click', async () => { m.fechar(); await api.auth.sair().catch(() => {}); });
}

/* =========================================================
   NAVEGAÇÃO
   #painel  #pedidos  #cardapio/<categoria>  #ajustes/<aba>
   Um pedido aberto fica no fim do endereço: #pedidos@<id>
========================================================= */
let gavetaPorClique = false;
function rotear(forcar = false) {
  if (!perfil) return;
  const [rota, pedidoId] = decodeURIComponent(location.hash.slice(1) || 'painel').split('@');
  let [tela, sub] = rota.split('/');
  if (!NAV.some(n => n.id === tela && (!n.admin || isAdmin()))) tela = 'painel';
  if (forcar || rota !== rotaAtual) {
    rotaAtual = rota; telaAtual = tela;
    $$('[data-nav]').forEach(a => { if (a.dataset.nav === tela) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const el = $('#conteudo');
    document.title = `${NAV.find(n => n.id === tela)?.rot || 'Painel'} — Backoffice Rita Bolos`;
    ({ painel: telaPainel, hoje: telaHoje, pedidos: telaPedidos, relatorio: telaRelatorio, prejuizos: telaPrejuizos, cardapio: telaCardapio, ajustes: telaAjustes })[tela](el, sub);
    window.scrollTo(0, 0);
  }
  if (pedidoId) abrirGaveta(pedidoId); else fecharGaveta(true);
}
window.addEventListener('hashchange', () => rotear());

/** Abre o pedido por cima da tela atual (o botão voltar do celular fecha). */
function verPedido(id) {
  gavetaPorClique = true;
  location.hash = '#' + rotaAtual + '@' + id;
}
function fecharGaveta(semHistorico = false) {
  const g = $('#gaveta'); if (!g || !g.classList.contains('on')) return;
  g.classList.remove('on'); g.inert = true; $('#veu').classList.remove('on');
  gavetaAbertaId = null;
  document.body.style.overflow = '';
  if (!semHistorico && location.hash.includes('@')) {
    if (gavetaPorClique) { gavetaPorClique = false; history.back(); }
    else history.replaceState(null, '', '#' + rotaAtual);
  }
  if (precisaRecarregar) { precisaRecarregar = false; recarregarTela(); }
}
let precisaRecarregar = false;
function recarregarTela() {
  if (!telaAtual) return;
  const [, sub] = rotaAtual.split('/');
  if (telaAtual === 'painel') telaPainel($('#conteudo'), sub, true);
  if (telaAtual === 'pedidos') carregarPedidos(false, true);
  if (telaAtual === 'hoje') recarregarHoje();
}

/* Cabeçalho padrão das telas */
function cabecalho(titulo, acoes = '', subtitulo = '') {
  const secao = NAV.find(n => n.id === telaAtual)?.rot || titulo;
  return `<div class="page-head"><div class="ph-txt">
      <nav class="trilha" aria-label="Você está em"><a href="#painel" aria-label="Início">${ic('casa')}</a>${ic('seta', 'ic sep')}<span>${esc(secao)}</span></nav>
      <h1>${esc(titulo)}</h1>${subtitulo ? `<p class="ph-sub">${subtitulo}</p>` : ''}</div>
    <div class="acts">${acoes}</div></div>`;
}
/** Data por extenso em São Paulo, com inicial maiúscula: "Domingo, 4 de outubro". */
const dataLonga = () => { const s = new Date().toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };

/* Cliques globais */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act],[data-ped]');
  if (!a || !perfil) return;
  if (a.dataset.ped) { e.preventDefault(); verPedido(a.dataset.ped); return; }
  switch (a.dataset.act) {
    case 'conta': modalConta(); break;
    case 'novo-pedido': modalNovoPedido(); break;
    case 'tema': abrirMenuTema(a); break;
    case 'sair':
      confirmar('Sair da conta?', 'Você volta para a tela de entrada do backoffice.', { botao: 'Sair' })
        .then(ok => { if (ok) api.auth.sair().catch(() => {}); });
      break;
  }
});

/* =========================================================
   TEMPO REAL: pedido novo chega na hora
========================================================= */
let recarga = null;
function ligarTempoReal() {
  pararTempoReal?.();
  pararTempoReal = api.admin.pedidos.aoMudar(({ tipo, pedido }) => {
    if (tipo === 'INSERT' && pedido?.origem === 'site') {
      tocarAviso();
      toast(`Novo pedido ${pedido.codigo || ''} de ${pedido.cliente_nome || 'cliente'}`, { tipo: 'novo', acao: { rotulo: 'Ver', fn: () => verPedido(pedido.id) }, tempo: 12000 });
    }
    atualizarBadge();
    clearTimeout(recarga);
    recarga = setTimeout(() => {
      if (gavetaAbertaId && pedido?.id === gavetaAbertaId && tipo === 'UPDATE' && !salvandoGaveta) recarregarGaveta();
      if ($('#gaveta')?.classList.contains('on')) precisaRecarregar = true;
      else recarregarTela();
    }, 600);
  });
}
async function atualizarBadge() {
  try {
    const { total } = await api.admin.pedidos.listar({ status: 'recebido', porPagina: 1 });
    $$('[data-badge]').forEach(b => { b.textContent = total > 99 ? '99+' : total; b.hidden = !total; b.title = `${total} pedido(s) aguardando confirmação`; });
  } catch (e) { /* silencioso */ }
}

/* =========================================================
   INÍCIO
========================================================= */
async function iniciar() {
  try { api = await iniciarApi(); }
  catch (e) {
    console.error(e);
    telaErroConexao(/config/i.test(e.message || '') ? 'O backoffice ainda não foi ligado ao banco. Preencha o arquivo js/config.js.' : 'Não foi possível falar com o servidor. Verifique a internet.');
    return;
  }
  api.auth.aoMudar((evento) => {
    if (evento === 'SIGNED_OUT') { perfil = null; pararTempoReal?.(); pararTempoReal = null; fecharGaveta(true); telaLogin(); }
    if (evento === 'PASSWORD_RECOVERY') setTimeout(() => modalNovaSenha(), 300);
  });
  let usuario = null;
  try { usuario = await api.auth.usuario(); } catch (e) { usuario = null; }
  if (usuario) {
    try { await aposLogin(); } catch (e) { console.error(e); telaLogin(e.message); }
  } else telaLogin();
}

/* =========================================================
   PAINEL
========================================================= */
function linhaPedido(p) {
  const hoje = hojeISO();
  const atraso = !p.finalizado && p.data_retirada < hoje;
  const quandoCls = atraso ? 'atraso' : p.data_retirada === hoje ? 'hoje' : '';
  let pg = '';
  if (p.status !== 'cancelado') {
    if (Number(p.total) > 0 && Number(p.valor_pago) >= Number(p.total)) pg = `<span class="tag pago">${ic('ok')}Pago</span>`;
    else if (p.sinal_pago && Number(p.valor_pago) > 0) pg = `<span class="tag sinal">Sinal pago</span>`;
    else pg = `<span class="tag pend">Sinal pendente</span>`;
  }
  return `<button type="button" class="ped" data-ped="${esc(p.id)}" aria-label="Pedido ${esc(p.codigo)} de ${esc(p.cliente_nome)}, retirada ${esc(dataCurta(p.data_retirada))}">
    <span class="quando ${quandoCls}">${esc(dataCurta(p.data_retirada))}${atraso ? ' (atrasado)' : ''}<small>${p.hora_retirada ? esc(hora(p.hora_retirada)) : 'sem horário'}</small></span>
    <span class="meio"><span class="nome">${esc(p.cliente_nome)} <span class="cod">${esc(p.codigo)}${p.qtd_observacoes ? ` · ${p.qtd_observacoes} obs.` : ''}</span></span>
      <span class="itens">${esc(p.resumo_itens || '')}</span></span>
    <span class="dir">${pill(p.status_nome, p.status_cor)}<span class="total">${R(p.total)}</span>${pg}</span>
  </button>`;
}

/* Ícone de cada etapa na faixa de indicadores (status criados no cadastro usam o relógio) */
const ICONE_STATUS = { recebido: 'sino', confirmado: 'ok', em_producao: 'bolo', pronto: 'pedidos' };
async function telaPainel(el, _sub, silencioso = false) {
  const nome = perfil.nome.split(' ')[0];
  const acoes = `<a class="btn ghost" href="#hoje">${ic('hoje')}Tela Hoje</a><button type="button" class="btn primary" data-act="novo-pedido">${ic('mais')}Novo pedido</button>`;
  const cab = cabecalho('Painel', acoes, `${esc(dataLonga())} — como estão os pedidos da Rita Bolos.`);
  if (!silencioso) {
    el.innerHTML = cab + `<div class="hero-grid"><div class="skel" style="height:210px"></div><div class="skel" style="height:210px"></div></div>
      <div class="skel" style="height:86px;margin-bottom:18px"></div><div class="skel" style="height:260px"></div>`;
  }
  try {
    const [r, hoje, novos] = await Promise.all([
      api.admin.painel(),
      api.admin.pedidos.listar({ de: hojeISO(), ate: hojeISO(), apenasAbertos: true, porPagina: 50 }),
      api.admin.pedidos.listar({ status: 'recebido', porPagina: 8, ordenarPor: 'criado_em', crescente: false })
    ]);
    if (telaAtual !== 'painel') return;
    hoje.pedidos = hoje.pedidos.filter(confirmadoEmDiante);   // retiradas de hoje: só confirmados em diante
    r.retiradas_hoje = hoje.pedidos.length;
    const abertos = r.por_status.filter(s => !s.finalizado);
    const emAberto = abertos.reduce((s, x) => s + x.quantidade, 0);
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    const resumo = r.retiradas_hoje
      ? `Hoje tem <b>${plural(r.retiradas_hoje, 'retirada', 'retiradas')}</b> marcadas${r.retiradas_amanha ? ` e amanhã mais <b>${r.retiradas_amanha}</b>` : ''}.`
      : `Nenhuma retirada marcada para hoje${r.retiradas_amanha ? `; amanhã são <b>${r.retiradas_amanha}</b>` : ''}.`;
    const sinal = r.sinais_pendentes ? ` <b>${plural(r.sinais_pendentes, 'pedido', 'pedidos')}</b> ainda ${r.sinais_pendentes === 1 ? 'aguarda' : 'aguardam'} o sinal.` : ' Todos os pedidos em aberto já têm sinal.';
    const kpi = (href, filtro, cor, icone, rot, valor) => `<a class="kpi" href="${href}"${filtro ? ` data-filtro="${esc(filtro)}"` : ''} style="${corVars(cor)}">
        <span class="kpi-ic">${ic(icone)}</span><span class="kpi-t"><span>${esc(rot)}</span><strong>${valor}</strong></span></a>`;
    el.innerHTML = cab + `
      <div class="hero-grid">
        <section class="card hero">
          <div style="position:relative;z-index:1">
            <p class="eyebrow">Resumo do dia</p>
            <h2 class="hero-t">Olá, ${esc(nome)}!</h2>
            <p class="hero-txt">${resumo}${sinal}</p>
            <div class="hero-acts"><button type="button" class="btn primary" data-act="novo-pedido">${ic('mais')}Novo pedido</button>
              <a class="btn ghost" href="#pedidos" data-filtro="recebido">${ic('pedidos')}Pedidos para confirmar</a></div>
          </div>
          <div class="hero-stats">
            <a href="#hoje"><span>Retiradas hoje</span><strong>${r.retiradas_hoje}</strong></a>
            <a href="#pedidos" data-filtro="amanha"><span>Amanhã</span><strong>${r.retiradas_amanha}</strong></a>
            <a href="#pedidos" data-filtro="novos"><span>Novos hoje</span><strong>${r.novos_hoje}</strong></a>
          </div>
        </section>
        <section class="card destaque-card">
          <p class="eyebrow">A receber</p>
          <strong class="dc-val">${R(r.a_receber)}</strong>
          <span class="dc-chip">${ic('pedidos')}${plural(emAberto, 'pedido em aberto', 'pedidos em aberto')}</span>
          <p>Soma do que falta pagar nos pedidos em aberto (sinais e restantes).</p>
          <a class="btn sm" href="#pedidos" data-filtro="saldo">Ver pedidos com saldo ${ic('seta')}</a>
          <svg class="ic dc-art" aria-hidden="true"><use href="#i-moeda"/></svg>
        </section>
      </div>
      <div class="card kpi-strip">
        ${abertos.map(s => kpi('#pedidos', 'st:' + s.status, s.cor || '#2B7465', ICONE_STATUS[s.status] || 'relogio', s.nome, s.quantidade)).join('')}
        ${kpi('#pedidos', 'sinal', '#B9476A', 'moeda', 'Aguardando sinal', r.sinais_pendentes)}
      </div>
      <div class="cols">
        <section class="card"><div class="card-h"><div><p class="eyebrow">Balcão</p><h2>Retiradas de hoje</h2></div><a class="btn sm ghost" href="#hoje">Abrir a tela Hoje</a></div>
          ${hoje.pedidos.length ? `<div class="lista-ped">${hoje.pedidos.map(linhaPedido).join('')}</div>` : '<p class="vazio" style="padding:18px">Nenhuma retirada marcada para hoje.</p>'}</section>
        <section class="card"><div class="card-h"><div><p class="eyebrow">Atendimento</p><h2>Para confirmar</h2></div><a class="btn sm ghost" href="#pedidos" data-filtro="recebido">Ver todos</a></div>
          ${novos.pedidos.length ? `<div class="lista-ped">${novos.pedidos.map(linhaPedido).join('')}</div>` : '<p class="vazio" style="padding:18px">Nenhum pedido esperando confirmação.</p>'}</section>
      </div>`;
  } catch (e) {
    erroToast(e);
    if (!silencioso) el.innerHTML = cab + `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p><button type="button" class="btn primary" onclick="location.reload()">Tentar de novo</button></div>`;
  }
}
/* =========================================================
   RELATÓRIO DA SEMANA (segunda a domingo, pela data de retirada)
   #relatorio  ·  #relatorio/2026-09-28 (segunda-feira da semana)
========================================================= */
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const DIAS_SEMANA_LONGOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const isoMais = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10); };
/** Segunda-feira da semana de uma data ISO. */
function segundaDe(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const dow = (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;   // 0 = segunda
  return isoMais(iso, -dow);
}
const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const valorCurto = n => (n >= 1000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : R(n).replace(/ /g, ' ').replace(/,00$/, ''));

/** Números de uma semana a partir dos pedidos (retirada entre seg e dom). */
function resumoSemana(pedidos, ini) {
  const ret = statusRetirado()?.codigo;
  const validos = pedidos.filter(p => p.status !== 'cancelado');
  const soma = (l, f) => Math.round(l.reduce((s, p) => s + (Number(f(p)) || 0), 0) * 100) / 100;
  const dias = DIAS_SEMANA.map((rot, i) => {
    const iso = isoMais(ini, i), doDia = validos.filter(p => p.data_retirada === iso);
    return { rot, iso, pedidos: doDia.length, valor: soma(doDia, p => p.total) };
  });
  const porOrigem = {};
  validos.forEach(p => { porOrigem[p.origem] = (porOrigem[p.origem] || 0) + 1; });
  const faturamento = soma(validos, p => p.total);
  return {
    pedidos: validos.length,
    concluidos: validos.filter(p => p.status === ret || (p.finalizado && p.status !== 'cancelado')).length,
    cancelados: pedidos.length - validos.length,
    faturamento, recebido: soma(validos, p => p.valor_pago), aReceber: soma(validos, p => Math.max(0, Number(p.total) - Number(p.valor_pago))),
    ticket: validos.length ? Math.round(faturamento / validos.length * 100) / 100 : 0,
    dias, porOrigem
  };
}
async function carregarSemana(ini) {
  const r = await api.admin.pedidos.listar({ de: ini, ate: isoMais(ini, 6), porPagina: 1000, ordenarPor: 'data_retirada', crescente: true });
  return r.pedidos;
}
/** Itens mais vendidos (quantidade) entre os pedidos não cancelados. */
async function topProdutos(pedidos) {
  const ids = pedidos.filter(p => p.status !== 'cancelado').map(p => p.id);
  if (!ids.length) return [];
  const lotes = [];
  for (let i = 0; i < ids.length; i += 80) lotes.push(api.admin.pedidos.itens.listar({ filtros: { pedido_id: ids.slice(i, i + 80) }, ordenarPor: [['pedido_id', true]] }));
  const itens = (await Promise.all(lotes)).flat();
  const mapa = new Map();
  for (const i of itens) {
    const k = i.nome, x = mapa.get(k) || { nome: k, qtd: 0, valor: 0 };
    x.qtd += Number(i.quantidade) || 0; x.valor += (Number(i.preco_unitario) || 0) * (Number(i.quantidade) || 0);
    mapa.set(k, x);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor || b.qtd - a.qtd).slice(0, 6);
}

/* Variação contra a semana anterior: sobe/desce com ícone e texto, nunca só cor */
function variacao(atual, antes, { dinheiro = false, menorMelhor = false, periodo = 'semana anterior', zero = null } = {}) {
  const no = periodo.startsWith('mês') ? 'no' : 'na';
  if (!antes && !atual) return `<span class="delta neutro">igual ${no === 'no' ? 'ao' : 'à'} ${periodo}</span>`;
  if (!antes) return `<span class="delta neutro">${zero || (dinheiro ? 'sem vendas' : 'nenhum')} ${no} ${periodo}</span>`;
  const pct = Math.round((atual - antes) / antes * 100);
  if (pct === 0) return `<span class="delta neutro">igual ${no === 'no' ? 'ao' : 'à'} ${periodo}</span>`;
  const bom = menorMelhor ? pct < 0 : pct > 0;
  return `<span class="delta ${bom ? 'bom' : 'ruim'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%<span class="sr"> ${pct > 0 ? 'a mais' : 'a menos'}</span> <small>vs. ${dinheiro ? valorCurto(antes) : antes}</small></span>`;
}

/* Gráfico de colunas: vendas por dia (destaca o melhor dia, valores no topo) */
function graficoDias(dias) {
  const max = Math.max(...dias.map(d => d.valor), 0);
  // topo do eixo num valor redondo logo acima do maior dia (1, 1,2, 1,5, 2, 2,5, 3, 4, 5, 6, 8, 10 × potência de 10)
  const pot = max ? Math.pow(10, Math.floor(Math.log10(max))) : 100;
  const topo = max ? [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(f => f * pot).find(v => v >= max * 1.08) : 100;
  const melhor = max ? dias.findIndex(d => d.valor === max) : -1;
  const linhas = [1, .5, 0].map(f => `<div class="g-linha" style="bottom:${f * 100}%"><span>${valorCurto(topo * f)}</span></div>`).join('');
  return `<div class="g-colunas" role="img" aria-label="Vendas por dia: ${esc(dias.map(d => `${d.rot} ${R(d.valor)}`).join(', '))}">
      <div class="g-area">${linhas}
        ${dias.map((d, i) => `<div class="g-col${i === melhor ? ' top' : ''}" title="${esc(`${DIAS_SEMANA_LONGOS[i]}, ${ddmm(d.iso)}: ${R(d.valor)} em ${d.pedidos} ${d.pedidos === 1 ? 'pedido' : 'pedidos'}`)}">
          <span class="g-val">${d.valor ? valorCurto(d.valor) : ''}</span>
          <span class="g-barra" style="height:${topo ? Math.max(d.valor ? 2 : 0, d.valor / topo * 100) : 0}%"></span></div>`).join('')}
      </div>
      <div class="g-eixo">${dias.map(d => `<span><b>${d.rot}</b>${ddmm(d.iso)}</span>`).join('')}</div>
    </div>`;
}
/* Barras horizontais (origem e produtos): uma cor só, rótulo e valor em texto */
function barrasH(itens, fmtValor) {
  const max = Math.max(...itens.map(i => i.v), 1);
  return `<div class="g-barras">${itens.map(i => `<div class="gb-linha" title="${esc(i.rot)}: ${esc(fmtValor(i.v))}">
      <div class="gb-txt"><span>${esc(i.rot)}</span><b>${esc(fmtValor(i.v))}</b></div>
      <div class="gb-trilho"><i style="width:${Math.max(2, i.v / max * 100)}%"></i></div>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>`).join('')}</div>`;
}

async function telaRelatorio(el, sub) {
  const atual = segundaDe(hojeISO());
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sub || '') ? segundaDe(sub) : atual;
  const fim = isoMais(ini, 6), ehAtual = ini === atual;
  const nav = `<div class="sem-nav" role="group" aria-label="Escolher semana">
      <a class="btn icon ghost" href="#relatorio/${isoMais(ini, -7)}" aria-label="Semana anterior">${ic('voltar')}</a>
      <span class="sem-rot">${ddmm(ini)} a ${ddmm(fim)}${ehAtual ? ' <small>esta semana</small>' : ''}</span>
      <a class="btn icon ghost" ${ini >= atual ? 'aria-disabled="true" tabindex="-1"' : ''} href="#relatorio/${isoMais(ini, 7)}" aria-label="Próxima semana">${ic('seta')}</a>
      ${ehAtual ? '' : `<a class="btn sm ghost" href="#relatorio">Esta semana</a>`}</div>`;
  const cab = cabecalho('Relatório da semana', nav, `Vendas de segunda a domingo, pela data de retirada.${ehAtual ? ' A semana ainda está em andamento.' : ''}`);
  el.innerHTML = cab + `<div class="card kpi-strip">${'<div class="kpi"><div class="skel" style="height:44px;width:100%"></div></div>'.repeat(4)}</div><div class="skel" style="height:320px"></div>`;
  try {
    const [esta, anterior] = await Promise.all([carregarSemana(ini), carregarSemana(isoMais(ini, -7))]);
    if (telaAtual !== 'relatorio') return;
    const s = resumoSemana(esta, ini), a = resumoSemana(anterior, isoMais(ini, -7));
    const [top, prejS, prejA] = await Promise.all([topProdutos(esta).catch(() => []),
      api.admin.prejuizos.doPeriodo(ini, fim).catch(() => null), api.admin.prejuizos.doPeriodo(isoMais(ini, -7), isoMais(ini, -1)).catch(() => null)]);
    if (telaAtual !== 'relatorio') return;
    const melhor = s.dias.reduce((m, d) => (d.valor > m.valor ? d : m), s.dias[0]);
    const tile = (cor, icone, rot, valor, delta) => `<div class="kpi" style="${corVars(cor)}"><span class="kpi-ic">${ic(icone)}</span>
        <span class="kpi-t"><span>${rot}</span><strong>${valor}</strong>${delta}</span></div>`;
    const origens = Object.entries(s.porOrigem).sort((x, y) => y[1] - x[1]).map(([o, n]) => ({ rot: ORIGENS[o] || o, v: n, sub: `${Math.round(n / s.pedidos * 100)}% dos pedidos` }));
    el.innerHTML = cab + `
      <div class="hero-grid">
        <section class="card destaque-card">
          <p class="eyebrow">Faturamento da semana</p>
          <strong class="dc-val">${R(s.faturamento)}</strong>
          <span class="dc-chip">${variacao(s.faturamento, a.faturamento, { dinheiro: true }).replace('class="delta', 'class="delta claro')}</span>
          <p>${s.pedidos ? `${s.pedidos} ${s.pedidos === 1 ? 'pedido' : 'pedidos'} com retirada entre ${ddmm(ini)} e ${ddmm(fim)}. Cancelados não entram na conta.` : 'Nenhum pedido com retirada nesta semana.'}</p>
          <svg class="ic dc-art" aria-hidden="true"><use href="#i-grafico"/></svg>
        </section>
        <section class="card">
          <div class="card-h"><div><p class="eyebrow">Dinheiro</p><h2>Recebido e a receber</h2></div></div>
          <div class="sem-din">
            <div><span>Recebido</span><strong>${R(s.recebido)}</strong></div>
            <div><span>A receber</span><strong>${R(s.aReceber)}</strong></div>
          </div>
          <div class="hj-barra" role="img" aria-label="${s.faturamento ? Math.round(s.recebido / s.faturamento * 100) : 0}% recebido"><i style="width:${s.faturamento ? Math.min(100, s.recebido / s.faturamento * 100) : 0}%"></i></div>
          <p class="dica" style="margin:6px 0 0;color:var(--ink-3)">${s.faturamento ? Math.round(s.recebido / s.faturamento * 100) : 0}% do faturamento já foi pago (sinais e restantes).</p>
        </section>
      </div>
      <div class="card kpi-strip">
        ${tile('#2B7465', 'pedidos', 'Pedidos', s.pedidos, variacao(s.pedidos, a.pedidos))}
        ${tile('#7DC4B0', 'ok', 'Concluídos (retirados)', s.concluidos, variacao(s.concluidos, a.concluidos))}
        ${tile('#C9A15A', 'moeda', 'Ticket médio', R(s.ticket), variacao(s.ticket, a.ticket, { dinheiro: true }))}
        ${tile('#B9476A', 'x', 'Cancelados', s.cancelados, variacao(s.cancelados, a.cancelados, { menorMelhor: true }))}
        ${prejS ? `<a class="kpi" href="#prejuizos/${ini.slice(0, 7)}" style="${corVars('#A8405F')}"><span class="kpi-ic">${ic('alerta')}</span><span class="kpi-t"><span>Prejuízos</span><strong>${R(totalPrej(prejS))}</strong>${variacao(totalPrej(prejS), totalPrej(prejA || []), { dinheiro: true, menorMelhor: true, zero: 'nenhum prejuízo' })}</span></a>` : ''}
      </div>
      <section class="card" style="margin-bottom:18px">
        <div class="card-h"><div><p class="eyebrow">Vendas por dia</p><h2>${melhor.valor ? `Melhor dia: ${DIAS_SEMANA_LONGOS[s.dias.indexOf(melhor)]}, ${ddmm(melhor.iso)}` : 'Sem vendas nesta semana'}</h2></div>
          ${melhor.valor ? `<span class="tag pago">${R(melhor.valor)} · ${melhor.pedidos} ${melhor.pedidos === 1 ? 'pedido' : 'pedidos'}</span>` : ''}</div>
        ${graficoDias(s.dias)}
      </section>
      <div class="cols">
        <section class="card"><div class="card-h"><div><p class="eyebrow">Mais vendidos</p><h2>Produtos da semana</h2></div></div>
          ${top.length ? barrasH(top.map(t => ({ rot: t.nome, v: t.valor, sub: `${t.qtd} ${t.qtd === 1 ? 'unidade' : 'unidades'}` })), v => R(v).replace(/ /g, ' ')) : '<p class="vazio" style="padding:18px">Nenhum item vendido.</p>'}</section>
        <section class="card"><div class="card-h"><div><p class="eyebrow">Canais</p><h2>De onde vieram os pedidos</h2></div></div>
          ${origens.length ? barrasH(origens, v => `${v} ${v === 1 ? 'pedido' : 'pedidos'}`) : '<p class="vazio" style="padding:18px">Nenhum pedido.</p>'}</section>
      </div>
      <section class="card tabela" style="margin-top:18px" aria-label="Tabela da semana por dia">
        <div class="card-h" style="padding:18px 22px 0"><div><p class="eyebrow">Detalhe</p><h2>Dia a dia</h2></div></div>
        <div class="sem-tab-wrap"><table class="sem-tab">
          <thead><tr><th scope="col">Dia</th><th scope="col">Pedidos</th><th scope="col">Vendas</th><th scope="col">Ticket médio</th></tr></thead>
          <tbody>${s.dias.map((d, i) => `<tr${d === melhor && d.valor ? ' class="top"' : ''}><th scope="row">${DIAS_SEMANA_LONGOS[i]}, ${ddmm(d.iso)}</th><td>${d.pedidos}</td><td>${R(d.valor)}</td><td>${d.pedidos ? R(d.valor / d.pedidos) : '—'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th><td>${s.pedidos}</td><td>${R(s.faturamento)}</td><td>${s.pedidos ? R(s.ticket) : '—'}</td></tr></tfoot>
        </table></div>
      </section>`;
  } catch (e) {
    erroToast(e);
    el.innerHTML = cab + `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p></div>`;
  }
}

/* =========================================================
   PREJUÍZOS: itens refeitos ou perdidos (sabor errado, item trocado, queda...)
   #prejuizos  ·  #prejuizos/2026-10 (mês)
========================================================= */
const MOTIVOS = {
  sabor_errado: 'Sabor errado', item_errado: 'Item errado ou trocado', danificado: 'Danificado (queda, transporte)',
  qualidade: 'Problema de qualidade', atraso: 'Atraso ou esquecido', outro: 'Outro'
};
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const totalPrej = l => Math.round(l.reduce((s, x) => s + Number(x.quantidade) * Number(x.valor_unitario), 0) * 100) / 100;
function limitesMes(ym) {
  const [a, m] = ym.split('-').map(Number);
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${ym}-01`, ate: `${ym}-${String(ult).padStart(2, '0')}`, rot: `${MESES_LONGOS[m - 1]} de ${a}` };
}
const mesMais = (ym, n) => { const [a, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

async function telaPrejuizos(el, sub) {
  const atual = hojeISO().slice(0, 7);
  const ym = /^\d{4}-\d{2}$/.test(sub || '') && sub <= atual ? sub : atual;
  const { de, ate, rot } = limitesMes(ym);
  const nav = `<div class="sem-nav" role="group" aria-label="Escolher mês">
      <a class="btn icon ghost" href="#prejuizos/${mesMais(ym, -1)}" aria-label="Mês anterior">${ic('voltar')}</a>
      <span class="sem-rot">${rot.charAt(0).toUpperCase() + rot.slice(1)}${ym === atual ? ' <small>este mês</small>' : ''}</span>
      <a class="btn icon ghost" ${ym >= atual ? 'aria-disabled="true" tabindex="-1"' : ''} href="#prejuizos/${mesMais(ym, 1)}" aria-label="Próximo mês">${ic('seta')}</a>
      <button type="button" class="btn primary" data-prej-novo>${ic('mais')}Lançar prejuízo</button></div>`;
  const cab = cabecalho('Prejuízos', nav, 'Itens que precisaram ser refeitos ou foram perdidos, ligados ao pedido.');
  el.innerHTML = cab + '<div class="skel" style="height:96px;margin-bottom:18px"></div><div class="skel" style="height:260px"></div>';
  try {
    const anterior = limitesMes(mesMais(ym, -1));
    const [lista, antes] = await Promise.all([api.admin.prejuizos.doPeriodo(de, ate), api.admin.prejuizos.doPeriodo(anterior.de, anterior.ate)]);
    if (telaAtual !== 'prejuizos') return;
    const total = totalPrej(lista), unidades = lista.reduce((s, x) => s + Number(x.quantidade), 0);
    const pedidos = new Set(lista.map(x => x.pedido_id || x.pedido_codigo).filter(Boolean)).size;
    const porMotivo = Object.entries(lista.reduce((o, x) => { o[x.motivo] = (o[x.motivo] || 0) + Number(x.quantidade) * Number(x.valor_unitario); return o; }, {}))
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ rot: MOTIVOS[k] || k, v: Math.round(v * 100) / 100 }));
    const porItem = Object.values(lista.reduce((o, x) => { const k = x.item_nome; o[k] = o[k] || { rot: k, v: 0, q: 0 }; o[k].v += Number(x.quantidade) * Number(x.valor_unitario); o[k].q += Number(x.quantidade); return o; }, {}))
      .sort((a, b) => b.v - a.v).slice(0, 6).map(x => ({ ...x, sub: `${x.q} ${x.q === 1 ? 'unidade refeita' : 'unidades refeitas'}` }));
    const tile = (cor, icone, r, valor, delta) => `<div class="kpi" style="${corVars(cor)}"><span class="kpi-ic">${ic(icone)}</span><span class="kpi-t"><span>${r}</span><strong>${valor}</strong>${delta || ''}</span></div>`;
    const rs = v => R(v).replace(/ /g, ' ');
    el.innerHTML = cab + (lista.length || antes.length ? `
      <div class="card kpi-strip">
        ${tile('#B9476A', 'alerta', 'Prejuízo no mês', R(total), variacao(total, totalPrej(antes), { dinheiro: true, menorMelhor: true, periodo: 'mês anterior', zero: 'nenhum prejuízo' }))}
        ${tile('#C9A15A', 'pedidos', 'Pedidos afetados', pedidos)}
        ${tile('#6E4B3A', 'bolo', 'Unidades refeitas', unidades)}
        ${tile('#2B7465', 'moeda', 'Lançamentos', lista.length, variacao(lista.length, antes.length, { menorMelhor: true, periodo: 'mês anterior' }))}
      </div>
      ${lista.length ? `<div class="cols" style="margin-bottom:18px">
        <section class="card"><div class="card-h"><div><p class="eyebrow">Por motivo</p><h2>O que mais deu errado</h2></div></div>${barrasH(porMotivo, rs)}</section>
        <section class="card"><div class="card-h"><div><p class="eyebrow">Por produto</p><h2>Itens com mais prejuízo</h2></div></div>${barrasH(porItem, rs)}</section>
      </div>` : ''}
      <section class="card tabela" aria-label="Lançamentos do mês">
        <div class="card-h" style="padding:18px 22px 0"><div><p class="eyebrow">Lançamentos</p><h2>${lista.length ? `${lista.length} ${lista.length === 1 ? 'lançamento' : 'lançamentos'} em ${rot}` : `Nenhum prejuízo em ${rot}`}</h2></div></div>
        ${lista.length ? `<div class="sem-tab-wrap"><table class="sem-tab prej-tab">
          <thead><tr><th scope="col">Data</th><th scope="col">Pedido</th><th scope="col">Item</th><th scope="col">Motivo</th><th scope="col">Qtd.</th><th scope="col">Total</th><th scope="col"><span class="sr">Ações</span></th></tr></thead>
          <tbody>${lista.map(x => `<tr>
            <td class="num">${esc(ddmm(x.data))}</td>
            <td>${x.pedido_id ? `<a href="#" data-ped="${esc(x.pedido_id)}">${esc(x.pedido_codigo || 'pedido')}</a>` : esc(x.pedido_codigo || '—')}<small>${esc(x.cliente_nome || '')}</small></td>
            <td>${esc(x.item_nome)}${x.descricao ? `<small>${esc(x.descricao)}</small>` : ''}</td>
            <td><span class="tag pend">${esc(MOTIVOS[x.motivo] || x.motivo)}</span></td>
            <td class="num">${x.quantidade} × ${R(x.valor_unitario)}</td>
            <td class="num"><b>${R(Number(x.quantidade) * Number(x.valor_unitario))}</b></td>
            <td class="num"><button type="button" class="btn icon sm ghost" data-prej-tirar="${esc(x.id)}" aria-label="Apagar lançamento de ${esc(x.item_nome)}">${ic('lixo')}</button></td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row" colspan="5">Total do mês</th><td class="num">${R(total)}</td><td></td></tr></tfoot>
        </table></div>` : `<div class="vazio"><p>Nada lançado neste mês.</p></div>`}
      </section>` : `<div class="card vazio" style="padding:48px 20px">${ic('alerta')}<h2>Nenhum prejuízo lançado</h2>
        <p>Quando um item precisar ser refeito (por exemplo, bolo entregue com o sabor errado), lance aqui ou pelo botão “Prejuízo” dentro do pedido.</p>
        <button type="button" class="btn primary" data-prej-novo style="margin-top:12px">${ic('mais')}Lançar prejuízo</button></div>`);
  } catch (e) {
    erroToast(e);
    el.innerHTML = cab + `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(/prejuizos|42P01|does not exist|não existe/i.test(e.message) ? 'A tabela de prejuízos ainda não existe no banco. Rode o arquivo sql/prejuizos.sql no Supabase.' : e.message)}</p></div>`;
  }
}
document.addEventListener('click', async e => {
  if (e.target.closest('[data-prej-novo]')) { modalPrejuizo(); return; }
  const tirar = e.target.closest('[data-prej-tirar]');
  if (tirar && telaAtual === 'prejuizos') {
    if (!await confirmar('Apagar este lançamento?', 'O valor sai do total de prejuízos.', { botao: 'Apagar', perigo: true })) return;
    await ocupado(tirar, async () => { await api.admin.prejuizos.remover(tirar.dataset.prejTirar); toast('Lançamento apagado.'); recarregarPrejuizos(); });
  }
});
function recarregarPrejuizos() { if (telaAtual === 'prejuizos') telaPrejuizos($('#conteudo'), rotaAtual.split('/')[1]); }

/** Lançar prejuízo: escolhe o pedido, marca quantos de cada item deram problema. pedido = já aberto (vindo da gaveta). */
async function modalPrejuizo(pedido = null) {
  const m = abrirModal({
    titulo: 'Lançar prejuízo', largo: true,
    corpo: `<div id="prjPasso1" ${pedido ? 'hidden' : ''}>
        <div class="busca">${ic('busca')}<label class="sr" for="prjBusca">Buscar pedido</label>
          <input class="in" id="prjBusca" type="search" placeholder="Nome do cliente, telefone ou código (RB-01001)" autocomplete="off"></div>
        <div id="prjResultados" class="prj-resultados"><p class="dica" style="margin:10px 2px;color:var(--ink-3)">Digite para encontrar o pedido que deu prejuízo.</p></div>
      </div>
      <div id="prjPasso2"></div>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok disabled>${ic('ok')}Lançar</button>`
  });
  let atual = null;
  const desenharPedido = async p => {
    atual = p;
    m.$('#prjPasso1').hidden = true;
    const ja = await api.admin.prejuizos.listar({ filtros: { pedido_id: p.id } }).catch(() => []);
    m.$('#prjPasso2').innerHTML = `
      <div class="prj-ped"><div><strong>${esc(p.cliente_nome)}</strong><small>${esc(p.codigo)} · retirada ${esc(formatarData(p.data_retirada))} · ${esc(p.status_nome || '')}</small></div>
        ${pedido ? '' : '<button type="button" class="btn sm ghost" data-prj-trocar>Trocar pedido</button>'}</div>
      ${ja.length ? `<p class="aviso-box" style="margin:0 0 12px">Já ${ja.length === 1 ? 'existe 1 lançamento' : `existem ${ja.length} lançamentos`} para este pedido, somando ${R(totalPrej(ja))}.</p>` : ''}
      <p class="secao-t" style="margin-top:6px">Quais itens deram problema?</p>
      <div class="prj-itens">${p.itens.map((i, n) => `<div class="prj-it" data-n="${n}">
          <div class="prj-it-t"><strong>${i.quantidade}× ${esc(i.nome)}${i.peso_kg ? ` · ${esc(formatarPeso(i.peso_kg))}` : ''}</strong>
            <small>${[i.massa, i.formato, i.segundo_recheio ? '2º recheio: ' + i.segundo_recheio : '', separarReferencia(i.observacao).texto].filter(Boolean).map(esc).join(' · ')}</small></div>
          <div class="prj-it-q"><label class="sr" for="prjQ${n}">Quantos com problema</label>
            <button type="button" class="btn icon sm ghost" data-prj-q="-${n}" aria-label="Menos">${ic('menos')}</button>
            <input class="in" id="prjQ${n}" type="number" min="0" max="${i.quantidade}" value="0" inputmode="numeric">
            <button type="button" class="btn icon sm ghost" data-prj-q="+${n}" aria-label="Mais">${ic('mais')}</button></div>
          <div class="prj-it-v">${inDin('prjV' + n, 'Valor por unidade', i.preco_unitario)}</div>
        </div>`).join('')}</div>
      <div class="grid2" style="margin-top:14px">${inSel('prjMotivo', 'Motivo', Object.entries(MOTIVOS), 'sabor_errado')}
        ${campo('prjData', 'Data', `<input class="in" id="prjData" type="date" value="${hojeISO()}" max="${hojeISO()}">`)}</div>
      ${inTa('prjDesc', 'O que aconteceu <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', '', { attrs: 'maxlength="500" placeholder="Ex.: entregue como chocolate, cliente pediu ninho. Fizemos outro bolo." style="min-height:70px"' })}
      <div class="prj-total"><span>Prejuízo deste lançamento</span><strong id="prjTotal">${R(0)}</strong></div>
      <p class="dica" style="margin:4px 0 0;color:var(--ink-3)">O valor vem do preço do item no pedido; ajuste se o custo de refazer foi outro.</p>`;
    atualizar();
    m.$('[data-prj-trocar]')?.addEventListener('click', () => { atual = null; m.$('#prjPasso2').innerHTML = ''; m.$('#prjPasso1').hidden = false; atualizar(); m.$('#prjBusca').focus(); });
  };
  const linhas = () => !atual ? [] : atual.itens.map((i, n) => ({ i, q: Math.max(0, Math.floor(Number(m.$('#prjQ' + n)?.value) || 0)), v: lerValor(m.$('#prjV' + n)?.value) })).filter(x => x.q > 0);
  const atualizar = () => {
    const l = linhas(), total = l.reduce((s, x) => s + x.q * (Number.isFinite(x.v) ? x.v : 0), 0);
    if (m.$('#prjTotal')) m.$('#prjTotal').textContent = R(total);
    m.$('[data-ok]').disabled = !l.length;
    m.$('[data-ok]').innerHTML = `${ic('ok')}${l.length ? `Lançar ${R(total)}` : 'Lançar'}`;
  };
  m.el.addEventListener('input', e => { if (/^prj[QV]\d+$/.test(e.target.id)) atualizar(); });
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-prj-q]'); if (!b) return;
    const n = b.dataset.prjQ.slice(1), inp = m.$('#prjQ' + n), max = Number(inp.max);
    inp.value = Math.max(0, Math.min(max, (Number(inp.value) || 0) + (b.dataset.prjQ[0] === '+' ? 1 : -1)));
    atualizar();
  });
  // busca de pedidos
  let tBusca = null;
  m.$('#prjBusca').addEventListener('input', e => {
    clearTimeout(tBusca);
    const termo = e.target.value.trim();
    tBusca = setTimeout(async () => {
      if (termo.length < 2) { m.$('#prjResultados').innerHTML = '<p class="dica" style="margin:10px 2px;color:var(--ink-3)">Digite pelo menos 2 letras.</p>'; return; }
      try {
        const r = await api.admin.pedidos.listar({ busca: termo, porPagina: 8, ordenarPor: 'data_retirada', crescente: false });
        m.$('#prjResultados').innerHTML = r.pedidos.length ? r.pedidos.map(p => `<button type="button" class="prj-res" data-prj-ped="${esc(p.id)}">
            <span><strong>${esc(p.cliente_nome)}</strong><small>${esc(p.codigo)} · ${esc(formatarData(p.data_retirada))} · ${esc(p.resumo_itens || '')}</small></span>${pill(p.status_nome, p.status_cor)}</button>`).join('')
          : '<p class="dica" style="margin:10px 2px;color:var(--ink-3)">Nenhum pedido encontrado.</p>';
      } catch (err) { erroToast(err); }
    }, 250);
  });
  m.$('#prjResultados').addEventListener('click', e => {
    const b = e.target.closest('[data-prj-ped]'); if (!b) return;
    ocupado(b, async () => desenharPedido(await api.admin.pedidos.obter(b.dataset.prjPed)));
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    const l = linhas();
    if (!l.length) throw new Error('Marque quantos itens deram problema.');
    if (l.some(x => !Number.isFinite(x.v) || x.v < 0)) throw new Error('Confira o valor por unidade dos itens marcados.');
    const motivo = valDe(m, 'prjMotivo'), descricao = valDe(m, 'prjDesc') || null, data = valDe(m, 'prjData') || hojeISO();
    await api.admin.prejuizos.criarVarios(l.map(x => ({
      pedido_id: atual.id, pedido_codigo: atual.codigo, cliente_nome: atual.cliente_nome, produto_id: x.i.produto_id || null,
      item_nome: x.i.nome + (x.i.peso_kg ? ` ${formatarPeso(x.i.peso_kg)}` : ''), quantidade: x.q, valor_unitario: x.v, motivo, descricao, data
    })));
    const total = l.reduce((s, x) => s + x.q * x.v, 0);
    m.fechar();
    toast(`Prejuízo de ${R(total).replace(/ /g, ' ')} lançado no pedido ${atual.codigo}.`);
    recarregarPrejuizos();
  }));
  if (pedido) desenharPedido(pedido); else setTimeout(() => m.$('#prjBusca').focus(), 60);
}

/* Atalhos do painel para a lista já filtrada */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-filtro]'); if (!a) return;
  const f = a.dataset.filtro;
  Object.assign(filtro, { busca: '', status: 'abertos', periodo: 'proximas', extra: null });
  if (f === 'hoje') filtro.periodo = 'hoje';
  if (f === 'amanha') filtro.periodo = 'amanha';
  if (f === 'novos') { filtro.periodo = 'todas'; filtro.status = 'todos'; filtro.extra = 'novos'; }
  if (f === 'sinal') { filtro.periodo = 'todas'; filtro.extra = 'sinal'; }
  if (f === 'saldo') { filtro.periodo = 'todas'; filtro.extra = 'saldo'; }
  if (f === 'recebido') { filtro.periodo = 'todas'; filtro.status = 'recebido'; }
  if (f === 'atrasados') { filtro.periodo = 'atrasadas'; filtro.status = 'abertos'; }
  if (f.startsWith('st:')) { filtro.periodo = 'todas'; filtro.status = f.slice(3); }
  if (telaAtual === 'pedidos') { e.preventDefault(); telaPedidos($('#conteudo')); }
});

/* =========================================================
   HOJE: retiradas do dia, tela resumida para o balcão
========================================================= */
let hojeLista = [], hojeBusca = '', hojeAberto = null, hojeDia = null, hojeAtrasados = 0;
const hojeDetalhes = new Map(), hojeVersao = new Map();
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Pedido já confirmado (sinal pago) ou mais adiante. Os que só foram recebidos ficam fora das listas do dia. */
function confirmadoEmDiante(p) {
  const conf = STATUS.find(s => s.codigo === 'confirmado');
  if (!conf) return p.status !== 'recebido';
  return (statusDe(p.status).ordem ?? 0) >= conf.ordem;
}
function statusRetirado() {
  return STATUS.find(s => s.codigo === 'retirado' && s.ativo)
    || STATUS.filter(s => s.finalizado && s.ativo && s.codigo !== 'cancelado').sort((a, b) => a.ordem - b.ordem)[0] || null;
}
/** Situação do pagamento: 100% pago, parte paga (ex.: 50%) ou nada pago, e quanto falta. */
function situacaoPagamento(p) {
  const total = Number(p.total) || 0, pago = Number(p.valor_pago) || 0;
  const falta = Math.max(0, Math.round((total - pago) * 100) / 100);
  if (total <= 0 || pago >= total) return { cls: 'pago', rot: 'Pago 100%', pct: 100, falta: 0 };
  if (pago <= 0) return { cls: 'pend', rot: 'Nada pago', pct: 0, falta };
  const pct = Math.max(1, Math.min(99, Math.floor(pago / total * 100)));
  return { cls: 'sinal', rot: `Pago ${pct}%`, pct, falta };
}
async function telaHoje(el) {
  hojeDia = hojeISO();
  el.innerHTML = cabecalho('Hoje', `<button type="button" class="btn ghost" data-act="novo-pedido">${ic('mais')}Novo pedido</button>`,
      `${esc(dataLonga())} — retiradas do dia no balcão.`) + `
    <div class="hj-top"><div class="busca">${ic('busca')}<label class="sr" for="hjBusca">Buscar pelo nome</label>
      <input class="in" id="hjBusca" type="search" placeholder="Buscar pelo nome do cliente" value="${esc(hojeBusca)}" autocomplete="off"></div></div>
    <div class="hj-resumo" id="hjResumo" aria-live="polite"></div>
    <div id="hjAtraso"></div>
    <div class="hj-lista" id="hjLista">${'<div class="skel" style="height:64px"></div>'.repeat(4)}</div>`;
  $('#hjBusca').addEventListener('input', e => { hojeBusca = e.target.value; desenharHoje(); });
  await recarregarHoje(true);
}
async function recarregarHoje(primeira = false) {
  if (telaAtual !== 'hoje') return;
  if (hojeISO() !== hojeDia) { hojeAberto = null; return telaHoje($('#conteudo')); }
  try {
    const [r, atr] = await Promise.all([
      api.admin.pedidos.listar({ de: hojeDia, ate: hojeDia, porPagina: 300 }),
      api.admin.pedidos.listar({ antesDe: hojeDia, apenasAbertos: true, porPagina: 1 })
    ]);
    if (telaAtual !== 'hoje') return;
    const ret = statusRetirado();
    // só confirmados em diante (quem ainda não pagou o sinal fica em Pedidos); cancelados não aparecem
    hojeLista = r.pedidos.filter(p => (!p.finalizado || p.status === ret?.codigo) && confirmadoEmDiante(p));
    hojeAtrasados = atr.total || 0;
    for (const p of hojeLista) {
      if (hojeVersao.get(p.id) !== p.atualizado_em) { hojeDetalhes.delete(p.id); hojeVersao.set(p.id, p.atualizado_em); }
    }
    desenharHoje();
  } catch (e) {
    erroToast(e);
    if (primeira) $('#hjLista').innerHTML = `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p></div>`;
  }
}
function cartaoHoje(p) {
  const pg = situacaoPagamento(p), aberto = hojeAberto === p.id;
  return `<article class="hj ${aberto ? 'aberto' : ''} ${p.finalizado ? 'feito' : ''}" data-hj="${esc(p.id)}">
    <button type="button" class="hj-row" aria-expanded="${aberto}" aria-controls="hjd-${esc(p.id)}">
      <span class="hj-hora ${p.hora_retirada ? '' : 'sem'}">${p.hora_retirada ? esc(hora(p.hora_retirada)) : 'sem horário'}</span>
      <span class="hj-nome"><strong>${esc(p.cliente_nome)}</strong><small>${esc(p.codigo)} · ${esc(p.status_nome)}</small></span>
      <span class="hj-pg"><span class="tag ${pg.cls}">${pg.cls === 'pago' ? ic('ok') : ''}${pg.rot}</span>
        <span class="falta ${pg.falta ? '' : 'zero'}">${pg.falta ? 'Falta ' + R(pg.falta) : 'Quitado'}</span></span>
      ${ic('voltar', 'ic hj-chev')}
    </button>
    <div class="hj-det" id="hjd-${esc(p.id)}" ${aberto ? '' : 'hidden'}>${aberto ? detalheHoje(p.id) : ''}</div>
  </article>`;
}
function desenharHoje() {
  const lista = $('#hjLista'); if (!lista || telaAtual !== 'hoje') return;
  const ret = statusRetirado();
  const termo = semAcento(hojeBusca).trim(), digitos = termo.replace(/\D/g, '');
  const bate = p => !termo || semAcento(p.cliente_nome).includes(termo) || semAcento(p.codigo).includes(termo)
    || (digitos.length >= 4 && String(p.cliente_telefone || '').replace(/\D/g, '').includes(digitos));
  const porHora = (a, b) => (a.hora_retirada || '99').localeCompare(b.hora_retirada || '99') || a.cliente_nome.localeCompare(b.cliente_nome);
  const pendentes = hojeLista.filter(p => !p.finalizado).sort(porHora);
  const feitos = hojeLista.filter(p => p.finalizado).sort(porHora);
  const aReceber = hojeLista.reduce((s, p) => s + situacaoPagamento(p).falta, 0);   // inclui quem levou sem pagar tudo
  $('#hjResumo').innerHTML = `<span><b>${pendentes.length}</b> para ${pendentes.length === 1 ? 'retirar' : 'retirar'}</span>
    <span><b>${feitos.length}</b> já ${esc((ret?.nome || 'retirado').toLowerCase())}${feitos.length === 1 ? '' : 's'}</span>
    <span>Falta receber hoje <b>${R(aReceber)}</b></span>`;
  $('#hjAtraso').innerHTML = hojeAtrasados
    ? `<div class="aviso-box hj-atraso">${hojeAtrasados === 1 ? '1 pedido de dias anteriores ainda não foi retirado.' : `${hojeAtrasados} pedidos de dias anteriores ainda não foram retirados.`}
       <a href="#pedidos" data-filtro="atrasados">Ver</a></div>` : '';
  const pv = pendentes.filter(bate), fv = feitos.filter(bate);
  if (termo && !pv.length && !fv.length) {
    lista.innerHTML = `<div class="vazio"><h2>Ninguém com “${esc(hojeBusca)}” hoje</h2><p>Confira o nome ou procure em Pedidos, que busca em todas as datas.</p></div>`;
    return;
  }
  lista.innerHTML = (pv.length ? pv.map(cartaoHoje).join('')
      : (termo ? '' : `<div class="vazio"><h2>${feitos.length ? 'Tudo retirado por hoje' : 'Nenhuma retirada marcada para hoje'}</h2><p>${feitos.length ? 'Bom trabalho!' : 'Os pedidos com retirada hoje aparecem aqui.'}</p></div>`))
    + (fv.length ? `<p class="hj-sec">Já ${esc((ret?.nome || 'retirado').toLowerCase())}s</p>${fv.map(cartaoHoje).join('')}` : '');
}
function detalheHoje(id) {
  const p = hojeDetalhes.get(id);
  if (!p) { carregarDetalheHoje(id); return '<div class="skel" style="height:140px"></div>'; }
  const pg = situacaoPagamento(p), ret = statusRetirado();
  const itens = p.itens.map(i => {
    const det = [i.peso_kg && formatarPeso(i.peso_kg), i.massa, i.formato, i.segundo_recheio && '2º recheio: ' + i.segundo_recheio, i.faixa_preco].filter(Boolean);
    return `<div class="hj-it"><div class="l"><b>${i.quantidade}× ${esc(i.nome)}</b><span>${R(i.subtotal)}</span></div>
      ${det.length ? `<small>${det.map(esc).join(' · ')}</small>` : ''}${(() => { const o = separarReferencia(i.observacao);
        return `${o.texto ? `<small class="obs">Obs.: ${esc(o.texto)}</small>` : ''}${o.imagem ? `<a class="hj-ref" href="${esc(o.imagem)}" target="_blank" rel="noopener"><img src="${esc(o.imagem)}" alt="" loading="lazy">Imagem de referência</a>` : ''}`; })()}</div>`;
  }).join('');
  const fixadas = (p.observacoes || []).filter(o => o.fixada);
  const anterior = p.finalizado ? (p.historico || []).slice().reverse().find(h => h.status_novo === p.status)?.status_anterior : null;
  return `<div class="hj-cols">
      <section class="hj-box"><h3>O que tem no pedido</h3>${itens}
        ${p.observacao_cliente ? `<p class="hj-nota"><b>Observação do cliente:</b> ${esc(p.observacao_cliente)}</p>` : ''}
        ${fixadas.map(o => `<p class="hj-nota fix">📌 ${esc(o.texto)}</p>`).join('')}</section>
      <section class="hj-box hj-pagto"><h3>Pagamento</h3>
        <div class="lin"><span>Total do pedido</span><b>${R(p.total)}</b></div>
        <div class="lin"><span>Já pago</span><b>${R(p.valor_pago)} <span class="tag ${pg.cls}">${pg.pct}%</span></b></div>
        <div class="hj-barra" role="img" aria-label="${pg.pct}% pago"><i style="width:${pg.pct}%"></i></div>
        ${(p.pagamentos || []).map(g => `<small class="hj-pg-l">${esc(dataHora(g.pago_em))} · ${esc(FORMAS[g.forma] || g.forma)} · ${esc(TIPOS_PGTO[g.tipo] || g.tipo)}: <b>${R(g.valor)}</b></small>`).join('')}
        <div class="hj-falta-g ${pg.falta ? 'deve' : 'zero'}"><span>${pg.falta ? 'Falta pagar' : 'Tudo pago'}</span><span>${pg.falta ? R(pg.falta) : ic('ok')}</span></div>
      </section>
    </div>
    <div class="hj-acoes">
      ${!p.finalizado && ret ? `<button type="button" class="btn teal retirar" data-hj-retirar="${esc(id)}">${ic('ok')}Marcar como ${esc(ret.nome.toLowerCase())}</button>` : ''}
      ${p.finalizado && anterior ? `<button type="button" class="btn ghost" data-hj-desfazer="${esc(id)}" data-antes="${esc(anterior)}">${ic('atualizar')}Desfazer: voltar para “${esc(statusDe(anterior).nome)}”</button>` : ''}
      <button type="button" class="btn ghost" data-ped="${esc(id)}">Ver pedido completo</button>
    </div>`;
}
async function carregarDetalheHoje(id) {
  if (carregarDetalheHoje.emCurso.has(id)) return;
  carregarDetalheHoje.emCurso.add(id);
  try {
    const p = await api.admin.pedidos.obter(id);
    hojeDetalhes.set(id, p);
    const box = document.getElementById('hjd-' + id);
    if (box && hojeAberto === id) box.innerHTML = detalheHoje(id);
  } catch (e) { erroToast(e); }
  finally { carregarDetalheHoje.emCurso.delete(id); }
}
carregarDetalheHoje.emCurso = new Set();

async function modalRetirar(id) {
  const p = hojeDetalhes.get(id); const ret = statusRetirado();
  if (!p || !ret) return;
  const pg = situacaoPagamento(p);
  const aviso = await campoAvisoWa(p, ret);
  const m = abrirModal({
    titulo: `Marcar como ${ret.nome.toLowerCase()}`,
    corpo: `<p style="margin:0 0 12px;font-weight:500;font-size:16px">${esc(p.cliente_nome)} <span style="color:var(--ink-3);font-size:13px">${esc(p.codigo)}</span></p>
      <div class="hj-box hj-pagto" style="margin-bottom:14px">
        <div class="lin"><span>Total do pedido</span><b>${R(p.total)}</b></div>
        <div class="lin"><span>Já pago</span><b>${R(p.valor_pago)} (${pg.pct}%)</b></div>
        <div class="hj-falta-g ${pg.falta ? 'deve' : 'zero'}"><span>${pg.falta ? 'Falta pagar' : 'Tudo pago'}</span><span>${pg.falta ? R(pg.falta) : ic('ok')}</span></div>
      </div>
      ${pg.falta ? `${inChk('rtPagar', `Recebi agora os ${R(pg.falta)} que faltavam`, true)}
        <div id="rtFormaBox" style="margin-top:10px">${inSel('rtForma', 'Forma de pagamento', Object.entries(FORMAS), 'pix')}</div>
        <p class="dica" style="margin:4px 0 0">Desmarque se o cliente vai pagar depois. O valor continua em “a receber”.</p>` : ''}
      ${aviso}`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn teal" data-ok>${ic('ok')}Confirmar</button>`
  });
  ligarAvisoWa(m, 'Confirmar');
  setTimeout(() => m.$('[data-ok]').focus(), 60);
  m.$('#rtPagar')?.addEventListener('change', e => { m.$('#rtFormaBox').hidden = !e.target.checked; });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    const wa = avisoWa(m, p);   // abre a aba do WhatsApp ainda no clique (nada foi aguardado até aqui)
    const falhou = e => { wa.cancelar(); throw e; };
    const antes = p.status, idsAntes = new Set((p.pagamentos || []).map(g => g.id));
    let pgtoId = null, forma = null;
    if (pg.falta && chkDe(m, 'rtPagar')) {
      forma = valDe(m, 'rtForma');
      const r1 = await api.admin.pedidos.registrarPagamento(id, { valor: pg.falta, forma, tipo: Number(p.valor_pago) > 0 ? 'restante' : 'outro', observacao: 'Recebido na retirada' }).catch(falhou);
      pgtoId = (r1.pagamentos || []).find(g => !idsAntes.has(g.id))?.id || null;
    }
    const comentario = pgtoId ? `Retirado. Restante de ${R(pg.falta).replace(/\u00a0/g, ' ')} recebido (${FORMAS[forma] || forma}).` : (pg.falta ? `Retirado com ${R(pg.falta).replace(/\u00a0/g, ' ')} ainda a receber.` : 'Retirado.');
    const r2 = await api.admin.pedidos.alterarStatus(id, ret.codigo, comentario).catch(falhou);
    wa.enviar();
    m.fechar();
    hojeDetalhes.set(id, r2); hojeAberto = null;
    toast(`${p.cliente_nome} (${p.codigo}): ${ret.nome.toLowerCase()}${pgtoId ? ' e pago' : ''}.`, { acao: { rotulo: 'Desfazer', fn: () => desfazerRetirada(id, antes, pgtoId) } });
    await recarregarHoje(); atualizarBadge();
  }));
}
async function desfazerRetirada(id, statusAntes, pgtoId, btn = null) {
  await ocupado(btn, async () => {
    if (pgtoId) await api.admin.pedidos.removerPagamento(pgtoId);
    const r = await api.admin.pedidos.alterarStatus(id, statusAntes, 'Retirada desfeita.');
    hojeDetalhes.set(id, r);
    toast(`Voltou para “${statusDe(statusAntes).nome}”.`);
    await recarregarHoje(); atualizarBadge();
  });
}
document.addEventListener('click', e => {
  if (telaAtual !== 'hoje' || !e.target.closest('#hjLista')) return;
  const ret = e.target.closest('[data-hj-retirar]');
  if (ret) { modalRetirar(ret.dataset.hjRetirar); return; }
  const des = e.target.closest('[data-hj-desfazer]');
  if (des) { desfazerRetirada(des.dataset.hjDesfazer, des.dataset.antes, null, des); return; }
  const row = e.target.closest('.hj-row'); if (!row) return;
  const id = row.closest('[data-hj]').dataset.hj;
  hojeAberto = hojeAberto === id ? null : id;
  $$('#hjLista .hj').forEach(art => {
    const aberto = art.dataset.hj === hojeAberto;
    art.classList.toggle('aberto', aberto);
    art.querySelector('.hj-row').setAttribute('aria-expanded', String(aberto));
    const det = art.querySelector('.hj-det');
    det.hidden = !aberto;
    det.innerHTML = aberto ? detalheHoje(art.dataset.hj) : '';
  });
  if (hojeAberto) setTimeout(() => row.closest('.hj').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
});
setInterval(() => { if (telaAtual === 'hoje' && hojeDia && hojeISO() !== hojeDia) recarregarHoje(); }, 60000);

/* =========================================================
   PEDIDOS (lista)
========================================================= */
const filtro = { busca: '', status: 'abertos', periodo: 'proximas', extra: null };
const PERIODOS = [['proximas', 'Hoje em diante'], ['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['semana', 'Próximos 7 dias'], ['atrasadas', 'Retirada já passou'], ['todas', 'Todas as datas']];
const EXTRAS = { novos: 'Feitos hoje', sinal: 'Aguardando sinal', saldo: 'Com saldo a receber' };
let listaPedidos = [], totalPedidos = 0, paginaPedidos = 1;

function telaPedidos(el) {
  const chips = [['abertos', 'Em aberto'], ...STATUS.filter(s => s.ativo).sort((a, b) => a.ordem - b.ordem).map(s => [s.codigo, s.nome, s.cor]), ['todos', 'Todos']];
  el.innerHTML = cabecalho('Pedidos', `<button type="button" class="btn primary" data-act="novo-pedido">${ic('mais')}Novo pedido</button>`,
      'Pedidos do site, do WhatsApp e do balcão. Toque em um pedido para ver tudo.') + `
    <div class="filtros">
      <div class="linha">
        <div class="busca">${ic('busca')}<label class="sr" for="fBusca">Buscar pedido</label>
          <input class="in" id="fBusca" type="search" placeholder="Nome, telefone ou código (RB-01001)" value="${esc(filtro.busca)}" autocomplete="off"></div>
        <label class="sr" for="fPeriodo">Data de retirada</label>
        <select class="sel" id="fPeriodo" style="width:auto;flex:0 1 220px">${PERIODOS.map(([v, t]) => `<option value="${v}" ${v === filtro.periodo ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>
      <div class="chips" role="group" aria-label="Filtrar por status">${chips.map(([v, t, cor]) => `<button type="button" class="chip" data-fst="${esc(v)}" aria-pressed="${v === filtro.status}">${cor ? `<span class="dot" style="background:${esc(cor)}"></span>` : ''}${esc(t)}</button>`).join('')}</div>
      ${filtro.extra ? `<div class="linha"><button type="button" class="chip" data-limpar-extra aria-pressed="true">${esc(EXTRAS[filtro.extra])} ${ic('x')}</button></div>` : ''}
    </div>
    <section class="card tabela" aria-label="Lista de pedidos">
      <div class="tab-cab" aria-hidden="true"><span>Retirada</span><span>Cliente e itens</span><span>Status e total</span></div>
      <div class="lista-ped" id="listaPed">${'<div class="skel"></div>'.repeat(4)}</div>
      <div class="tab-pe"><span id="pedResumo"></span><div class="mais" id="maisPed"></div></div>
    </section>`;
  let t;
  $('#fBusca').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filtro.busca = e.target.value; carregarPedidos(); }, 300); });
  $('#fPeriodo').addEventListener('change', e => { filtro.periodo = e.target.value; carregarPedidos(); });
  el.querySelector('.chips').addEventListener('click', e => {
    const b = e.target.closest('[data-fst]'); if (!b) return;
    filtro.status = b.dataset.fst;
    $$('[data-fst]', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    carregarPedidos();
  });
  el.querySelector('[data-limpar-extra]')?.addEventListener('click', () => { filtro.extra = null; telaPedidos(el); });
  carregarPedidos();
}
function consultaPedidos() {
  const f = { busca: filtro.busca, porPagina: 30 };
  if (filtro.status === 'abertos') f.apenasAbertos = true;
  else if (filtro.status !== 'todos') f.status = filtro.status;
  const h = hojeISO();
  switch (filtro.periodo) {
    case 'proximas': f.de = h; break;
    case 'hoje': f.de = f.ate = h; break;
    case 'amanha': f.de = f.ate = hojeISO(1); break;
    case 'semana': f.de = h; f.ate = hojeISO(6); break;
    case 'atrasadas': f.antesDe = h; f.crescente = false; break;
    case 'todas': f.crescente = false; break;
  }
  if (filtro.extra === 'novos') { f.criadoDesde = `${h}T00:00:00-03:00`; f.ordenarPor = 'criado_em'; f.crescente = false; }
  if (filtro.extra === 'sinal') { f.sinalPago = false; f.apenasAbertos = true; f.crescente = true; }
  if (filtro.extra === 'saldo') { f.comSaldo = true; f.apenasAbertos = true; f.crescente = true; }
  if (filtro.busca.trim()) { delete f.de; delete f.ate; delete f.antesDe; }   // a busca procura em todas as datas
  return f;
}
async function carregarPedidos(mais = false, silencioso = false) {
  const lista = $('#listaPed'); if (!lista) return;
  if (!mais) paginaPedidos = 1;
  if (!mais && !silencioso) lista.innerHTML = '<div class="skel"></div>'.repeat(3);
  const pedido = ++carregarPedidos.n;
  try {
    const f = { ...consultaPedidos(), pagina: mais ? paginaPedidos + 1 : 1 };
    if (silencioso && !mais) f.porPagina = Math.max(30, listaPedidos.length);
    const r = await api.admin.pedidos.listar(f);
    if (pedido !== carregarPedidos.n || !$('#listaPed')) return;
    if (mais) { paginaPedidos++; listaPedidos = listaPedidos.concat(r.pedidos); } else listaPedidos = r.pedidos;
    totalPedidos = r.total;
    lista.innerHTML = listaPedidos.length ? listaPedidos.map(linhaPedido).join('')
      : `<div class="vazio"><h2>Nenhum pedido aqui</h2><p>${filtro.busca ? 'Nada encontrado para essa busca.' : 'Tente outro filtro de data ou status.'}</p></div>`;
    $('#pedResumo').textContent = totalPedidos ? `${totalPedidos} ${totalPedidos === 1 ? 'pedido' : 'pedidos'}${filtro.busca ? (totalPedidos === 1 ? ' encontrado' : ' encontrados') : ''}` : '';
    $('#maisPed').innerHTML = listaPedidos.length < totalPedidos ? `<button type="button" class="btn ghost" id="btnMais">Carregar mais (${totalPedidos - listaPedidos.length})</button>` : '';
    $('#btnMais')?.addEventListener('click', e => ocupado(e.currentTarget, () => carregarPedidos(true)));
  } catch (e) {
    erroToast(e);
    if (!mais) lista.innerHTML = `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p></div>`;
  }
}
carregarPedidos.n = 0;

/* =========================================================
   PEDIDO (gaveta lateral)
========================================================= */
let gavetaAbertaId = null, pedidoAtual = null, salvandoGaveta = false;
async function abrirGaveta(id) {
  const g = $('#gaveta'); if (!g) return;
  const jaAberta = g.classList.contains('on') && gavetaAbertaId === id;
  gavetaAbertaId = id;
  if (!jaAberta) {
    g.innerHTML = `<div class="gav-h"><button type="button" class="btn icon sm ghost" data-gav="fechar" aria-label="Fechar">${ic('voltar')}</button><h2 id="gavTitulo">Carregando…</h2></div>
      <div class="gav-b"><div class="skel"></div><div class="skel" style="margin-top:12px;height:180px"></div></div>`;
    g.classList.add('on'); g.inert = false; $('#veu').classList.add('on');
    document.body.style.overflow = 'hidden';
    setTimeout(() => g.querySelector('[data-gav="fechar"]')?.focus(), 60);
  }
  try {
    const p = await api.admin.pedidos.obter(id);
    if (gavetaAbertaId !== id) return;
    renderGaveta(p);
  } catch (e) {
    erroToast(e);
    g.querySelector('.gav-b').innerHTML = `<div class="vazio"><h2>Pedido não encontrado</h2><p>${esc(e.message)}</p></div>`;
  }
}
async function recarregarGaveta() {
  if (!gavetaAbertaId) return;
  try { renderGaveta(await api.admin.pedidos.obter(gavetaAbertaId)); } catch (e) { /* mantém o que está na tela */ }
}
function proximoStatus(p) {
  const atual = statusDe(p.status);
  if (atual.finalizado) return null;
  return STATUS.filter(s => s.ativo && s.ordem > (atual.ordem ?? 0) && s.codigo !== 'cancelado').sort((a, b) => a.ordem - b.ordem)[0] || null;
}
/* ---- Imagem de referência do item (topper): vem do site na observação, como "Referência: <link>" ---- */
function itemReferencia(i) {
  const { texto, imagem } = separarReferencia(i.observacao), topper = ehTopper(i.nome, i.categoria);
  const obs = texto ? `<div class="it-d"><b>Obs.:</b> ${esc(texto)}</div>` : '';
  if (!imagem && !topper) return obs;
  const inp = `<input type="file" accept="image/*" id="refIt-${esc(i.id)}" data-ref-item="${esc(i.id)}" class="sr" tabindex="-1">`;
  return obs + (imagem
    ? `<div class="it-ref"><a class="it-ref-img" href="${esc(imagem)}" target="_blank" rel="noopener" title="Abrir a imagem"><img src="${esc(imagem)}" alt="Imagem de referência de ${esc(i.nome)}" loading="lazy"></a>
        <div class="it-ref-acoes"><span>Imagem de referência</span>
          <button type="button" class="btn sm wa" data-gav="topo" data-item="${esc(i.id)}">${ic('wa')}Enviar para quem faz o topo</button>
          <label class="btn sm ghost" for="refIt-${esc(i.id)}">${ic('foto')}Trocar imagem</label></div></div>${inp}`
    : `<div class="it-ref sem"><span>${ic('alerta')}Sem imagem de referência</span><label class="btn sm ghost" for="refIt-${esc(i.id)}">${ic('foto')}Anexar imagem</label></div>${inp}`);
}
/** Reduz a foto antes de enviar (até 1600 px, JPEG). */
async function reduzirImagem(arquivo, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type || '')) return arquivo;
  const bmp = await createImageBitmap(arquivo).catch(() => null); if (!bmp) return arquivo;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
  return blob && blob.size < arquivo.size ? blob : arquivo;
}
// anexar ou trocar a imagem de um item pelo backoffice (ex.: o cliente mandou pelo WhatsApp)
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset?.refItem || !t.files?.[0] || !pedidoAtual) return;
  const arquivo = t.files[0], i = pedidoAtual.itens.find(x => String(x.id) === t.dataset.refItem); t.value = '';
  if (!i) return;
  acaoGaveta(null, async () => {
    if (!/^image\//.test(arquivo.type || '')) throw new Error('Escolha um arquivo de imagem.');
    const img = await reduzirImagem(arquivo);
    const { url } = await api.referencias.enviar(img);
    await api.admin.pedidos.itens.atualizar(i.id, { observacao: juntarReferencia(separarReferencia(i.observacao).texto, url) });
    toast('Imagem de referência anexada.');
    return api.admin.pedidos.obter(pedidoAtual.id);
  });
});

/* ---- Enviar o topo para quem faz: imagem, tipo e data ---- */
async function contatoTopos() {
  const c = await configLoja();
  let local = {}; try { local = JSON.parse(localStorage.getItem('ritabolos.topos') || '{}'); } catch (e) { local = {}; }
  return { numero: c?.whatsapp_topos || local.numero || '', nome: c?.nome_topos || local.nome || '' };
}
async function salvarContatoTopos(numero, nome) {
  try { localStorage.setItem('ritabolos.topos', JSON.stringify({ numero, nome })); } catch (e) { /* sem armazenamento */ }
  // sem o sql/referencias-topper.sql (ou sem acesso de administração), fica só neste aparelho
  try { await api.admin.configuracoes.salvar({ whatsapp_topos: numero || null, nome_topos: nome || null }); cacheLoja = null; } catch (e) { /* idem */ }
}
async function modalTopo(p, i) {
  const { texto, imagem } = separarReferencia(i.observacao);
  const ct = await contatoTopos();
  const quando = `${formatarData(p.data_retirada)} (${dataCurta(p.data_retirada)})${p.hora_retirada ? ' às ' + hora(p.hora_retirada) : ''}`;
  const msg = [`Olá${ct.nome ? ', ' + ct.nome.trim().split(/\s+/)[0] : ''}! Tem um topo de bolo para fazer:`, '',
    `*Pedido:* ${p.codigo} (${p.cliente_nome})`, `*Tipo:* ${i.quantidade > 1 ? i.quantidade + '× ' : ''}${i.nome}`,
    texto ? `*Tema / detalhes:* ${texto}` : null, `*Data:* ${quando}`, '', imagem ? `*Imagem de referência:* ${linkCompartilhavel(imagem)}` : null]
    .filter(l => l !== null).join('\n');
  // a foto em si vai pelo "Compartilhar" do celular; o link vai na mensagem
  const arquivo = imagem && navigator.canShare ? fetch(imagem).then(r => r.blob()).then(b => new File([b], `topo-${p.codigo}.${/png/.test(b.type) ? 'png' : 'jpg'}`, { type: b.type || 'image/jpeg' })).catch(() => null) : Promise.resolve(null);
  const podeCompartilhar = !!imagem && !!navigator.canShare;
  const m = abrirModal({
    titulo: 'Enviar para quem faz o topo',
    corpo: `<div class="topo-prev">${imagem ? `<img src="${esc(imagem)}" alt="Imagem de referência">` : ''}
        <div><strong>${i.quantidade > 1 ? i.quantidade + '× ' : ''}${esc(i.nome)}</strong>${texto ? `<small>${esc(texto)}</small>` : ''}<small>Data: ${esc(quando)}</small></div></div>
      <div class="grid2">${inTxt('tpNum', 'WhatsApp de quem faz o topo', formatarTel(ct.numero), { attrs: ATTR_TEL })}${inTxt('tpNome', 'Nome <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', ct.nome, { attrs: 'maxlength="60"' })}</div>
      ${inTa('tpMsg', 'Mensagem', msg, { attrs: 'maxlength="1500" style="min-height:170px"' })}
      <p class="dica" style="margin:0">O contato fica salvo para os próximos topos. ${podeCompartilhar ? 'No celular, <b>Compartilhar imagem</b> manda a foto em si: escolha o WhatsApp e a pessoa.' : 'A mensagem leva o link da imagem.'}</p>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button>${podeCompartilhar ? `<button type="button" class="btn ghost" data-compartilhar>${ic('foto')}Compartilhar imagem</button>` : ''}<button type="button" class="btn wa" data-ok>${ic('wa')}Abrir WhatsApp</button>`
  });
  const lembrar = num => { const nome = valDe(m, 'tpNome'); if (num !== digitosTel(ct.numero) || nome !== ct.nome) salvarContatoTopos(num, nome); };
  m.$('[data-ok]').addEventListener('click', () => {
    const num = digitosTel(valDe(m, 'tpNum'));
    if (num.length < 10) { toast('Informe o WhatsApp com DDD de quem faz o topo.', { tipo: 'erro' }); m.$('#tpNum').focus(); return; }
    abrirWhatsApp(linkWhatsApp('55' + num, valDe(m, 'tpMsg')));   // ainda no clique, para o navegador não bloquear
    lembrar(num); m.fechar();
  });
  m.$('[data-compartilhar]')?.addEventListener('click', async () => {
    const f = await arquivo;
    if (!f || !navigator.canShare({ files: [f] })) { toast('Este aparelho não compartilha a imagem. Use “Abrir WhatsApp”: a mensagem leva o link.', { tipo: 'erro' }); return; }
    try { await navigator.share({ files: [f], text: valDe(m, 'tpMsg') }); lembrar(digitosTel(valDe(m, 'tpNum'))); m.fechar(); }
    catch (e) { if (e?.name !== 'AbortError') erroToast(e); }
  });
}

/* ---- Impressão na térmica (bobina de 80 mm, 72 mm de área de impressão) ---- */
async function imprimirTermica(p) {
  const loja = await configLoja() || {};
  const pct = Number(p.percentual_sinal ?? 50).toLocaleString('pt-BR');
  const falta = Math.max(0, Number(p.saldo ?? (p.total - p.valor_pago)));
  const l = (a, b, cls = '') => `<div class="l ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const itens = p.itens.map(i => {
    const { texto, imagem } = separarReferencia(i.observacao);
    const det = [i.massa && `Massa: ${i.massa}`, i.formato && `Formato: ${i.formato}`, i.segundo_recheio && `2º recheio: ${i.segundo_recheio}`].filter(Boolean);
    return `<div class="it">${l(`<b class="n">${i.quantidade}x ${esc(i.nome)}${i.peso_kg ? ' ' + esc(formatarPeso(i.peso_kg)) : ''}</b>`, R(i.subtotal))}
      ${det.map(d => `<div class="d">${esc(d)}</div>`).join('')}
      ${i.quantidade > 1 ? `<div class="d">${i.quantidade} x ${R(i.preco_unitario)}</div>` : ''}
      ${texto ? `<div class="d ob">Obs: ${esc(texto)}</div>` : ''}${imagem ? '<div class="d ob">* Imagem de referência anexada (ver no sistema)</div>' : ''}</div>`;
  }).join('<div class="sep fino"></div>');
  const fixadas = (p.observacoes || []).filter(o => o.fixada);
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido ${esc(p.codigo)}</title><style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #fff; color: #000; }
    body { width: 80mm; padding: 3mm 4mm 8mm; font: 12.5px/1.35 Arial, Helvetica, sans-serif; }
    .c { text-align: center; } .loja { font-size: 17px; font-weight: 900; } .sub { font-size: 11px; }
    .cod { font-size: 24px; font-weight: 900; letter-spacing: .5px; margin-top: 4px; }
    .sep { border-top: 1px dashed #000; margin: 6px 0; } .sep.fino { border-top-style: dotted; margin: 4px 0; } .sep.forte { border-top: 2px solid #000; }
    .ret { border: 2px solid #000; padding: 5px 6px; margin: 6px 0; text-align: center; }
    .ret small { display: block; font-size: 11px; font-weight: 700; letter-spacing: 1px; } .ret b { display: block; font-size: 18px; line-height: 1.2; }
    .l { display: flex; justify-content: space-between; gap: 8px; } .l > span:last-child { white-space: nowrap; text-align: right; }
    .t { font-size: 13px; font-weight: 800; letter-spacing: 1px; margin: 2px 0 4px; }
    .it .n { font-size: 13.5px; } .it .d { font-size: 11.5px; margin-left: 12px; } .it .ob { font-weight: 700; }
    .tot { font-size: 16px; font-weight: 900; } .falta { font-size: 15px; font-weight: 900; }
    .box { border: 1px solid #000; padding: 4px 6px; margin: 5px 0; font-size: 12px; } .box b { display: block; }
    .pix .k { display: block; font-size: 17px; font-weight: 900; letter-spacing: .5px; }
    .pe { text-align: center; font-size: 10.5px; margin-top: 8px; }
  </style></head><body>
    <div class="c loja">${esc(loja.nome_loja || 'Rita Bolos')}</div>
    <div class="c sub">${esc(loja.slogan || 'Bolos e sobremesas')}</div>
    <div class="c cod">${esc(p.codigo)}</div>
    <div class="c sub">Feito em ${esc(dataHora(p.criado_em))} · ${esc(ORIGENS[p.origem] || p.origem || '')}</div>
    <div class="sep"></div>
    <div><b>Cliente:</b> ${esc(p.cliente_nome)}</div>
    ${p.cliente_telefone ? `<div><b>Tel.:</b> ${esc(formatarTel(p.cliente_telefone) || p.cliente_telefone)}</div>` : ''}
    <div><b>Situação:</b> ${esc(p.status_nome || p.status)}</div>
    <div class="ret"><small>RETIRADA</small><b>${esc(dataCurta(p.data_retirada).toUpperCase())}</b><b>${esc(formatarData(p.data_retirada))}${p.hora_retirada ? ' às ' + esc(hora(p.hora_retirada)) : ''}</b></div>
    <div class="t">ITENS</div>${itens}
    <div class="sep forte"></div>
    ${l('Subtotal', R(p.subtotal))}${Number(p.desconto) > 0 ? l('Desconto', '- ' + R(p.desconto)) : ''}
    ${l('TOTAL', R(p.total), 'tot')}
    ${l(`Sinal (${pct}%)`, R(p.valor_sinal))}${l('Pago', R(p.valor_pago))}
    ${l(falta > 0 ? 'FALTA PAGAR' : 'PAGO', falta > 0 ? R(falta) : 'OK', 'falta')}
    ${p.observacao_cliente ? `<div class="box"><b>Observação do cliente</b>${esc(p.observacao_cliente)}</div>` : ''}
    ${fixadas.length ? `<div class="box"><b>Anotações</b>${fixadas.map(o => esc(o.texto)).join('<br>')}</div>` : ''}
    ${falta > 0 ? `<div class="box pix"><b>Pix (${esc(PIX.tipo)})</b><span class="k">${esc(PIX.chave)}</span>${esc(PIX.nome)}</div>` : ''}
    <div class="pe">${loja.whatsapp_exibicao ? 'WhatsApp ' + esc(loja.whatsapp_exibicao) + '<br>' : ''}Impresso em ${esc(dataHora(new Date().toISOString()))}</div>
  </body></html>`;
  $('#impTermica')?.remove();
  const f = document.createElement('iframe');
  f.id = 'impTermica'; f.title = 'Impressão'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  f.onload = () => setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { erroToast(e); } }, 120);
  f.srcdoc = html;
  document.body.appendChild(f);
}

function renderGaveta(p) {
  pedidoAtual = p;
  const g = $('#gaveta');
  const rolagem = g.querySelector('.gav-b')?.scrollTop || 0;
  const prox = proximoStatus(p);
  const itens = p.itens.map(i => `<div class="it">
      <div class="it-l"><span>${i.quantidade}× ${esc(i.nome)}${i.peso_kg ? ` <span style="color:var(--teal)">${esc(formatarPeso(i.peso_kg))}</span>` : ''}</span><span>${R(i.subtotal)}</span></div>
      ${i.massa || i.formato ? `<div class="it-d">${i.massa ? `<b>Massa:</b> ${esc(i.massa)}` : ''}${i.massa && i.formato ? ' · ' : ''}${i.formato ? `<b>Formato:</b> ${esc(i.formato)}` : ''}</div>` : ''}
      ${i.segundo_recheio ? `<div class="it-d"><b>2º recheio:</b> ${esc(i.segundo_recheio)}</div>` : ''}
      ${i.faixa_preco ? `<div class="it-d"><b>Faixa de preço:</b> ${esc(i.faixa_preco)}</div>` : ''}
      <div class="it-d">${R(i.preco_unitario)} cada${i.preco_kg ? ` (${R(i.preco_kg)} o kg)` : ''}</div>
      ${itemReferencia(i)}
    </div>`).join('');
  const quitado = Number(p.total) > 0 && Number(p.valor_pago) >= Number(p.total);
  g.innerHTML = `
    <div class="gav-h">
      <button type="button" class="btn icon sm ghost" data-gav="fechar" aria-label="Fechar pedido">${ic('voltar')}</button>
      <h2 id="gavTitulo">${esc(p.cliente_nome)}<small>${esc(p.codigo)} · ${esc(ORIGENS[p.origem] || p.origem)} · feito em ${esc(dataHora(p.criado_em))}</small></h2>
      <button type="button" class="btn icon sm ghost" data-gav="editar" aria-label="Editar dados do pedido">${ic('editar')}</button>
    </div>
    <div class="gav-b">
      <div class="acoes-topo">
        <a class="btn sm" href="${esc(urlReciboInterno(p.id))}" target="_blank" rel="noopener">${ic('imprimir')}Imprimir recibo</a>
        <button type="button" class="btn sm" data-gav="termica">${ic('imprimir')}Imprimir 80 mm</button>
        <button type="button" class="btn sm wa" data-gav="msg">${ic('wa')}Mandar mensagem</button>
        <button type="button" class="btn sm ghost" data-gav="link">${ic('copiar')}Link do recibo</button>
        ${isAdmin() ? `<button type="button" class="btn sm ghost" data-gav="prejuizo">${ic('alerta')}Lançar prejuízo</button>` : ''}
      </div>

      <section class="card"><div class="card-h"><h2>Status</h2>${pill(p.status_nome, p.status_cor)}</div>
        <div class="status-sel" role="group" aria-label="Mudar status">${STATUS.filter(s => s.ativo).sort((a, b) => a.ordem - b.ordem).map(s => {
          const atual = s.codigo === p.status;
          return `<button type="button" class="st-btn" data-status="${esc(s.codigo)}" ${atual ? `aria-current="true" style="background:${esc(s.cor)};color:${corTexto(s.cor)}"` : ''}><span class="dot" style="background:${esc(s.cor)}"></span>${esc(s.nome)}</button>`;
        }).join('')}</div>
        ${prox ? `<button type="button" class="btn teal block prox" data-status="${esc(prox.codigo)}">${ic('ok')}Avançar para “${esc(prox.nome)}”</button>` : ''}
      </section>

      <section class="card"><div class="card-h"><h2>Retirada</h2></div>
        <dl class="kv">
          <dt>Data</dt><dd>${esc(formatarData(p.data_retirada))} (${esc(dataCurta(p.data_retirada))})</dd>
          <dt>Horário</dt><dd>${p.hora_retirada ? esc(hora(p.hora_retirada)) : 'não informado'}</dd>
          <dt>Cliente</dt><dd>${esc(p.cliente_nome)}</dd>
          <dt>Telefone</dt><dd>${p.cliente_telefone ? `<a href="tel:${esc(String(p.cliente_telefone).replace(/[^\d+]/g, ''))}">${esc(formatarTel(p.cliente_telefone) || p.cliente_telefone)}</a>` : 'não informado'}</dd>
        </dl>
        ${p.observacao_cliente ? `<div class="cliente-obs"><b>Observação do cliente:</b> ${esc(p.observacao_cliente)}</div>` : ''}
      </section>

      <section class="card"><div class="card-h"><h2>Itens</h2><span class="tag cinza">${p.itens.length} ${p.itens.length === 1 ? 'item' : 'itens'}</span></div>${itens}</section>

      <section class="card valores"><div class="card-h"><h2>Valores</h2><button type="button" class="btn sm teal" data-gav="pagar">${ic('moeda')}Registrar pagamento</button></div>
        <div class="lin"><span>Subtotal</span><span>${R(p.subtotal)}</span></div>
        ${Number(p.desconto) > 0 ? `<div class="lin"><span>Desconto</span><span>− ${R(p.desconto)}</span></div>` : ''}
        <div class="lin tot"><span>Total</span><span>${R(p.total)}</span></div>
        <div class="lin"><span>Sinal (${Number(p.percentual_sinal).toLocaleString('pt-BR')}%)</span><span>${R(p.valor_sinal)}</span></div>
        <div class="lin"><span>Pago</span><span>${R(p.valor_pago)}</span></div>
        <div class="lin ${quitado ? 'quit' : 'saldo'}"><span>${quitado ? 'Quitado' : 'Falta receber'}</span><span>${quitado ? ic('ok') : R(p.saldo)}</span></div>
        ${p.pagamentos.length ? `<div style="margin-top:10px">${p.pagamentos.map(g2 => `<div class="pgto"><span><b>${R(g2.valor)}</b> · ${esc(FORMAS[g2.forma] || g2.forma)} · ${esc(TIPOS_PGTO[g2.tipo] || g2.tipo)}
          <small>${esc(dataHora(g2.pago_em))}${g2.observacao ? ' · ' + esc(g2.observacao) : ''}</small></span>
          <button type="button" class="btn icon sm ghost" data-gav="tirar-pgto" data-id="${esc(g2.id)}" aria-label="Remover pagamento de ${esc(R(g2.valor))}">${ic('lixo')}</button></div>`).join('')}</div>` : ''}
      </section>

      <section class="card"><div class="card-h"><h2>Observações internas</h2></div>
        <form id="fObs" novalidate>
          <label class="sr" for="obsTxt">Nova observação</label>
          <textarea class="ta" id="obsTxt" maxlength="2000" placeholder="Anote algo sobre este pedido. Só a equipe vê."></textarea>
          <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin:8px 0 12px;flex-wrap:wrap">
            ${inChk('obsFix', 'Fixar no topo', false)}
            <button type="submit" class="btn primary sm">Adicionar</button></div>
        </form>
        ${p.observacoes.map(o => `<div class="obs ${o.fixada ? 'fix' : ''}"><p>${esc(o.texto)}</p>
          <div class="meta"><span>${o.fixada ? '📌 ' : ''}${esc(o.autor_nome || 'Equipe')} · ${esc(dataHora(o.criado_em))}</span>
            <span class="bt"><button type="button" class="btn icon sm ghost" data-gav="fixar" data-id="${esc(o.id)}" data-fix="${o.fixada ? 0 : 1}" aria-label="${o.fixada ? 'Desafixar' : 'Fixar'} observação">${ic('pin')}</button>
            <button type="button" class="btn icon sm ghost" data-gav="tirar-obs" data-id="${esc(o.id)}" aria-label="Apagar observação">${ic('lixo')}</button></span></div></div>`).join('')}
      </section>

      <section class="card"><div class="card-h"><h2>Histórico</h2></div>
        <ul class="hist">${p.historico.slice().reverse().map(h => `<li style="--c:${esc(statusDe(h.status_novo).cor || '#2B7465')}"><b>${esc(h.status_nome || h.status_novo)}</b>
          <small>${esc(dataHora(h.alterado_em))}${h.alterado_por ? ' · ' + esc(h.alterado_por) : ''}</small>${h.comentario ? `<em>${esc(h.comentario)}</em>` : ''}</li>`).join('')}</ul>
      </section>
      ${isAdmin() ? `<div style="text-align:center;margin-top:18px"><button type="button" class="btn danger sm" data-gav="excluir">${ic('lixo')}Excluir pedido</button></div>` : ''}
    </div>`;
  g.querySelector('.gav-b').scrollTop = rolagem;
  $('#fObs').addEventListener('submit', e => {
    e.preventDefault();
    const txt = $('#obsTxt').value.trim();
    if (!txt) { $('#obsTxt').focus(); return; }
    acaoGaveta(e.submitter, async () => {
      await api.admin.pedidos.adicionarObservacao(p.id, txt, $('#obsFix').checked);
      toast('Observação adicionada.');
    });
  });
}
/** Ação no pedido aberto: executa, recarrega a gaveta e atualiza a lista ao fechar. */
async function acaoGaveta(btn, fn) {
  salvandoGaveta = true;
  const r = await ocupado(btn, async () => { const x = await fn(); precisaRecarregar = true; return x ?? true; });
  if (r && typeof r === 'object' && r.itens) renderGaveta(r);
  else if (r) await recarregarGaveta();
  setTimeout(() => { salvandoGaveta = false; }, 900);
  atualizarBadge();
}
document.addEventListener('click', async e => {
  const g = $('#gaveta'); if (!g || !g.contains(e.target)) return;
  const st = e.target.closest('[data-status]');
  if (st && pedidoAtual) { modalStatus(pedidoAtual, st.dataset.status); return; }
  const b = e.target.closest('[data-gav]'); if (!b) return;
  const p = pedidoAtual;
  switch (b.dataset.gav) {
    case 'fechar': fecharGaveta(); break;
    case 'editar': modalEditarPedido(p); break;
    case 'pagar': modalPagamento(p); break;
    case 'prejuizo': modalPrejuizo(p); break;
    case 'termica': imprimirTermica(p); break;
    case 'topo': { const i = p.itens.find(x => String(x.id) === b.dataset.item); if (i) modalTopo(p, i); break; }
    case 'msg':
      if (!telefoneWa(p.cliente_telefone)) toast('Este pedido não tem o telefone do cliente.', { acao: { rotulo: 'Incluir telefone', fn: () => modalEditarPedido(p) } });
      else modalMensagem(p);
      break;
    case 'link': {
      const url = await urlReciboCliente(p);
      try { await navigator.clipboard.writeText(url); toast('Link do recibo copiado. É o mesmo que o cliente recebe.'); }
      catch (err) { abrirModal({ titulo: 'Link do recibo', corpo: `<p class="dica" style="margin:0 0 8px">Copie o endereço abaixo:</p><input class="in" readonly value="${esc(url)}" onfocus="this.select()" autofocus>` }); }
      break;
    }
    case 'tirar-pgto':
      if (await confirmar('Remover pagamento?', 'O valor pago do pedido será recalculado.', { botao: 'Remover', perigo: true }))
        acaoGaveta(null, () => api.admin.pedidos.removerPagamento(b.dataset.id));
      break;
    case 'fixar': acaoGaveta(b, () => api.admin.pedidos.editarObservacao(Number(b.dataset.id) || b.dataset.id, { fixada: b.dataset.fix === '1' })); break;
    case 'tirar-obs':
      if (await confirmar('Apagar observação?', 'Esta anotação será apagada.', { botao: 'Apagar', perigo: true }))
        acaoGaveta(null, () => api.admin.pedidos.removerObservacao(Number(b.dataset.id) || b.dataset.id));
      break;
    case 'excluir':
      if (await confirmar(`Excluir o pedido ${p.codigo}?`, 'O pedido e todo o histórico serão apagados de vez. Para desistências, prefira o status “Cancelado”.', { botao: 'Excluir de vez', perigo: true })) {
        await ocupado(b, async () => { await api.admin.pedidos.remover(p.id); precisaRecarregar = true; fecharGaveta(); toast(`Pedido ${p.codigo} excluído.`); atualizarBadge(); });
      }
      break;
  }
});

/* =========================================================
   AVISO DE STATUS PELO WHATSAPP
   Ao mudar o status, abre o WhatsApp no número do cliente com a
   mensagem pronta; a equipe confere e aperta Enviar.
========================================================= */
async function urlReciboCliente(p) {
  return linkRecibo(p.token, (await configLoja())?.url_site || RAIZ_SITE) + (DEMO ? '&demo' : '');
}
/** Campo do modal de status: "Avisar no WhatsApp" + mensagem editável. */
async function campoAvisoWa(p, status) {
  if (!telefoneWa(p.cliente_telefone)) return `<p class="dica" style="margin:14px 0 0">Este pedido não tem o WhatsApp do cliente, então ninguém será avisado. Para avisar, inclua o telefone editando o pedido.</p>`;
  const nome = String(p.cliente_nome || '').trim().split(/\s+/)[0] || 'o cliente';
  const msg = montarMensagemStatus(p, status, await urlReciboCliente(p));
  return `<div style="margin-top:14px">${inChk('avWa', `Avisar ${esc(nome)} no WhatsApp`, true)}
    <div id="avWaBox" style="margin-top:6px">${inTa('avWaMsg', 'Mensagem <span style="font-weight:400;color:var(--ink-3)">(pode editar antes de enviar)</span>', msg, { attrs: 'maxlength="2000" style="min-height:170px"' })}</div></div>`;
}
function ligarAvisoWa(m, rotulo) {
  const chk = m.$('#avWa'), bt = m.$('[data-ok]'); if (!chk || !bt) return;
  const original = bt.innerHTML;
  const atualizar = () => { m.$('#avWaBox').hidden = !chk.checked; bt.innerHTML = chk.checked ? `${ic('wa')}${esc(rotulo)} e avisar` : original; };
  chk.addEventListener('change', atualizar); atualizar();
}
/** Chamar direto no clique, antes de qualquer await: já deixa a aba do WhatsApp aberta. */
function avisoWa(m, p) {
  const wa = telefoneWa(p.cliente_telefone), msg = valDe(m, 'avWaMsg');
  if (!wa || !chkDe(m, 'avWa') || !msg) return { enviar() {}, cancelar() {} };
  const aba = prepararAba(), url = linkWhatsApp(wa, msg);
  return {
    enviar() {
      if (!aba.ir(url)) toast(`O navegador bloqueou o WhatsApp. Avise ${p.cliente_nome} por aqui:`, { acao: { rotulo: 'Abrir WhatsApp', fn: () => abrirWhatsApp(url) } });
    },
    cancelar() { aba.fechar(); }
  };
}

/* =========================================================
   MENSAGEM AVULSA PARA O CLIENTE (botão "Mandar mensagem" do pedido)
   Modelos prontos com os dados do pedido; a equipe edita e o WhatsApp
   abre na conversa do cliente com o texto escrito.
========================================================= */
function modelosMensagem(p, urlRecibo) {
  const nome = String(p.cliente_nome || '').trim().split(/\s+/)[0] || '';
  const ola = `Olá${nome ? ', ' + nome : ''}! Aqui é da ${p.loja?.nome || 'Rita Bolos'}.`;
  const v = x => R(x).replace(/ /g, ' ');
  const ped = `*${p.codigo}*`;
  const d = p.data_retirada;
  const dia = d === hojeISO() ? 'hoje' : d === hojeISO(1) ? 'amanhã' : `no dia ${formatarData(d).slice(0, 5)}`;
  const quando = `${dia}${p.hora_retirada ? ' às ' + hora(p.hora_retirada) : ''}`;
  const saldo = Math.max(0, Number(p.saldo) || 0);
  const faltaSinal = Math.max(0, Math.round((Number(p.valor_sinal) - Number(p.valor_pago)) * 100) / 100);
  const itens = (p.itens || []).map(i => `• ${i.quantidade}× ${i.nome}${i.peso_kg ? ' ' + formatarPeso(i.peso_kg) : ''}`).join('\n');
  const st = statusDe(p.status);
  const modelos = [
    { id: 'oi', rot: 'Saudação', txt: `${ola}\n\nEstou falando sobre o seu pedido ${ped}.` },
    faltaSinal > 0 && !st.finalizado && { id: 'sinal', rot: 'Lembrar do sinal', txt: `${ola}\n\nPara confirmar o seu pedido ${ped}, falta o sinal de *${v(faltaSinal)}*. Pode mandar o comprovante por aqui mesmo.\n\nAgradecemos!` },
    !st.finalizado && { id: 'retirada', rot: 'Lembrar da retirada', txt: `${ola}\n\nPassando para lembrar: a retirada do seu pedido ${ped} é ${quando}.\n\n${itens}${saldo > 0 ? `\n\nNa retirada, falta pagar *${v(saldo)}*.` : ''}` },
    !st.finalizado && { id: 'pronto', rot: 'Pedido pronto', txt: `${ola}\n\nSeu pedido ${ped} está *pronto para retirada*!${p.hora_retirada || d ? ` Combinamos ${quando}.` : ''}${saldo > 0 ? `\n\nFalta pagar *${v(saldo)}*: pode ser na retirada.` : '\n\nEstá tudo pago, é só vir buscar.'}` },
    saldo > 0 && faltaSinal <= 0 && { id: 'saldo', rot: 'Saldo a pagar', txt: `${ola}\n\nO restante do seu pedido ${ped} é *${v(saldo)}*. Pode pagar na retirada ou mandar o comprovante por aqui.` },
    urlRecibo && { id: 'recibo', rot: 'Enviar recibo', txt: `${ola}\n\nAqui está o recibo do seu pedido ${ped}, com os itens e os valores:\n${urlRecibo}` },
    { id: 'livre', rot: 'Escrever do zero', txt: `${ola}\n\n` }
  ].filter(Boolean);
  // Começa pelo que mais faz sentido agora
  const sugerido = (p.status === 'recebido' && faltaSinal > 0 && 'sinal') || (p.status === 'pronto' && 'pronto')
    || ((d === hojeISO() || d === hojeISO(1)) && !st.finalizado && 'retirada') || 'oi';
  return { modelos, sugerido: modelos.some(m => m.id === sugerido) ? sugerido : 'oi' };
}
async function modalMensagem(p) {
  const wa = telefoneWa(p.cliente_telefone); if (!wa) return;
  const { modelos, sugerido } = modelosMensagem(p, await urlReciboCliente(p).catch(() => ''));
  const nome = String(p.cliente_nome || '').trim().split(/\s+/)[0] || 'cliente';
  const m = abrirModal({
    titulo: `Mensagem para ${nome}`,
    corpo: `<p class="dica" style="margin:0 0 12px;color:var(--ink-3)">${esc(p.cliente_nome)} · <span style="white-space:nowrap">${esc(formatarTel(p.cliente_telefone) || p.cliente_telefone)}</span> · <span style="white-space:nowrap">pedido ${esc(p.codigo)}</span></p>
      <div class="modelos" role="group" aria-label="Mensagens prontas">${modelos.map(x => `<button type="button" class="chip" data-modelo="${x.id}" aria-pressed="${x.id === sugerido}">${esc(x.rot)}</button>`).join('')}</div>
      ${inTa('msgTxt', 'Mensagem <span style="font-weight:400;color:var(--ink-3)">(pode editar antes de enviar)</span>', modelos.find(x => x.id === sugerido).txt, { attrs: 'maxlength="2000" style="min-height:200px"' })}
      <p class="dica" style="margin:-4px 0 0">O WhatsApp abre na conversa de ${esc(nome)} com o texto pronto. É só conferir e tocar em Enviar.</p>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn wa" data-ok>${ic('wa')}Abrir no WhatsApp</button>`
  });
  const ta = m.$('#msgTxt');
  m.$('.modelos').addEventListener('click', e => {
    const b = e.target.closest('[data-modelo]'); if (!b) return;
    m.$$('[data-modelo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    ta.value = modelos.find(x => x.id === b.dataset.modelo).txt;
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  m.$('[data-ok]').addEventListener('click', () => {
    const txt = ta.value.trim();
    if (!txt) { toast('Escreva a mensagem antes de abrir o WhatsApp.', { tipo: 'erro' }); ta.focus(); return; }
    abrirWhatsApp(linkWhatsApp(wa, txt));   // ainda dentro do clique: o navegador não bloqueia
    m.fechar();
    toast(`WhatsApp aberto na conversa de ${nome}.`);
  });
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 60);
}

async function modalStatus(p, codigo) {
  const s = statusDe(codigo);
  if (codigo === p.status) { toast(`O pedido já está como “${s.nome}”.`); return; }
  const aviso = await campoAvisoWa(p, s);
  // confirmar = sinal recebido: já registra o pagamento do que falta do sinal
  const faltaSinal = codigo === 'confirmado' ? Math.max(0, Math.round((Number(p.valor_sinal) - Number(p.valor_pago)) * 100) / 100) : 0;
  const m = abrirModal({
    titulo: `Mudar para “${s.nome}”`,
    corpo: `<p style="margin:0 0 12px;font-weight:400">${esc(p.codigo)} · ${esc(p.cliente_nome)}: de ${pill(p.status_nome, p.status_cor)} para ${pill(s.nome, s.cor)}</p>
      ${faltaSinal > 0 ? `<div class="np-concl on st-sinal">${inChk('stSinal', `<span><strong>Registrar o sinal de ${R(faltaSinal)} como pago</strong><small>O pagamento entra no pedido junto com a confirmação.</small></span>`, true)}
        <div class="np-concl-op">${inSel('stForma', 'Como foi pago', Object.entries(FORMAS), 'pix')}</div></div>` : ''}
      ${inTa('stCom', 'Comentário <span style="font-weight:400;color:var(--ink-3)">(opcional, fica no histórico)</span>', '', { attrs: `maxlength="500" placeholder="${codigo === 'cancelado' ? 'Motivo do cancelamento' : 'Ex.: sinal recebido por Pix'}" style="min-height:64px"` })}
      ${aviso}`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn ${codigo === 'cancelado' ? 'danger' : 'primary'}" data-ok>Mudar status</button>`
  });
  ligarAvisoWa(m, 'Mudar status');
  m.$('#stSinal')?.addEventListener('change', e => { m.$('.st-sinal').classList.toggle('on', e.target.checked); m.$('.st-sinal .np-concl-op').hidden = !e.target.checked; });
  setTimeout(() => m.$('[data-ok]').focus(), 60);
  m.$('[data-ok]').addEventListener('click', ev => {
    const com = valDe(m, 'stCom');
    const sinal = faltaSinal > 0 && chkDe(m, 'stSinal'), forma = valDe(m, 'stForma') || 'pix';
    const wa = avisoWa(m, p);   // abre a aba do WhatsApp ainda no clique
    m.fechar();
    acaoGaveta(null, async () => {
      if (sinal) await api.admin.pedidos.registrarPagamento(p.id, { valor: faltaSinal, forma, tipo: 'sinal', observacao: 'Registrado ao confirmar o pedido' })
        .catch(e => { wa.cancelar(); throw e; });
      const r = await api.admin.pedidos.alterarStatus(p.id, codigo, com || null).catch(e => { wa.cancelar(); throw e; });
      wa.enviar();
      toast(sinal ? `${p.codigo}: ${s.nome}, sinal de ${R(faltaSinal)} registrado` : `${p.codigo}: ${s.nome}`);
      return r;
    });
  });
}

function modalPagamento(p) {
  const faltaSinal = Math.max(0, Math.round((p.valor_sinal - p.valor_pago) * 100) / 100);
  const saldo = Math.max(0, Number(p.saldo));
  const tipo0 = faltaSinal > 0 ? 'sinal' : 'restante';
  const valor0 = faltaSinal > 0 ? faltaSinal : saldo;
  const m = abrirModal({
    titulo: 'Registrar pagamento',
    corpo: `<p style="margin:0 0 12px;font-weight:400">${esc(p.codigo)} · total ${R(p.total)} · já pago ${R(p.valor_pago)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${faltaSinal > 0 ? `<button type="button" class="chip" data-v="${faltaSinal}" data-t="sinal">Sinal ${R(faltaSinal)}</button>` : ''}
        ${saldo > 0 ? `<button type="button" class="chip" data-v="${saldo}" data-t="${p.valor_pago > 0 ? 'restante' : 'outro'}">${p.valor_pago > 0 ? 'Restante' : 'Total'} ${R(saldo)}</button>` : ''}
      </div>
      <div class="grid2">${inDin('pgValor', 'Valor', valor0 || '')}${inSel('pgForma', 'Forma', Object.entries(FORMAS), 'pix')}</div>
      <div class="grid2">${inSel('pgTipo', 'Referente a', Object.entries(TIPOS_PGTO), tipo0)}${campo('pgData', 'Recebido em', `<input class="in" id="pgData" type="datetime-local" value="${esc(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16))}">`)}</div>
      ${inTxt('pgObs', 'Observação <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', '', { attrs: 'maxlength="300" placeholder="Ex.: comprovante enviado no WhatsApp"' })}`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn teal" data-ok>${ic('moeda')}Registrar</button>`
  });
  m.$$('[data-v]').forEach(c => c.addEventListener('click', () => { m.$('#pgValor').value = valorTxt(c.dataset.v); m.$('#pgTipo').value = c.dataset.t; }));
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    const v = lerValor(valDe(m, 'pgValor'));
    if (!(v > 0)) { m.$('#pgValor').setAttribute('aria-invalid', 'true'); throw new Error('Informe um valor maior que zero.'); }
    const quando = valDe(m, 'pgData');
    m.fechar();
    await acaoGaveta(null, async () => {
      const r = await api.admin.pedidos.registrarPagamento(p.id, { valor: v, forma: valDe(m, 'pgForma'), tipo: valDe(m, 'pgTipo'), observacao: valDe(m, 'pgObs') || null, pagoEm: quando ? new Date(quando).toISOString() : null });
      toast(`Pagamento de ${R(v)} registrado.`);
      return r;
    });
  }));
}

/* Editar tudo do pedido: cliente, origem, retirada, desconto, observação e os itens (trocar, mudar, incluir, tirar).
   Pagamentos e status continuam nos botões próprios da gaveta. */
async function modalEditarPedido(p) {
  let c;
  try { c = await carregarCardapioAtivo(true); } catch (e) { erroToast(e); return; }
  const { prods, bolos, finalizacoes, opcoesProd, precoUnitario } = catalogoPedido(c);
  const porId = {}; Object.values(prods).forEach(x => { porId[x.id] = x; });
  // o item gravado guarda os nomes (massa, formato, 2º recheio); os campos usam o slug
  const massaSlug = nome => c.bolo.massas.find(x => x.nome === nome)?.slug || '';
  const formatoSlug = nome => (c.bolo.formatos || []).find(x => x.nome === nome)?.slug || '';
  const segSlug = nome => (nome && bolos.find(b => (b.rotulo || b.nome) === nome || b.nome === nome)?.slug) || '';
  const pesos = c.bolo.pesos.map(Number);
  const itensOrig = p.itens || [];
  let n = 0;
  const linha = (it = null) => {
    const k = ++n, prod = it ? porId[it.produto_id] : null;
    const fora = !!it && !prod;   // produto saiu do cardápio: o item fica, mas só muda quantidade, valor e observação
    const peso = it?.peso_kg ? Number(it.peso_kg) : pesos[0];
    const opPesos = [...new Set([...pesos, peso])].sort((a, b) => a - b);
    const sel = (lista, val) => lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const ref = separarReferencia(it?.observacao);   // a imagem de referência fica guardada à parte e volta para a observação ao salvar
    return `<div class="np-item" data-k="${k}" ${it ? `data-id="${esc(it.id)}"` : ''} data-ref="${esc(ref.imagem || '')}">
      ${campo('edP' + k, 'Produto', `<select class="sel" id="edP${k}" data-np="prod">${fora ? `<option value="">${esc(it.nome)} (fora do cardápio)</option>` : opcoesProd}</select>`)}
      ${campo('edQ' + k, 'Qtd.', `<input class="in" id="edQ${k}" data-np="qtd" type="number" min="1" max="999" value="${it ? it.quantidade : 1}" inputmode="numeric">`)}
      <button type="button" class="btn icon ghost" data-np="tirar" aria-label="Tirar item" style="align-self:end">${ic('lixo')}</button>
      <div class="bolo" hidden>
        ${campo('edW' + k, 'Peso', `<select class="sel" id="edW${k}" data-np="peso">${sel(opPesos.map(w => [w, formatarPeso(w)]), peso)}</select>`)}
        ${campo('edM' + k, 'Massa', `<select class="sel" id="edM${k}" data-np="massa">${sel(c.bolo.massas.map(mm => [mm.slug, mm.nome]), massaSlug(it?.massa))}</select>`)}
        ${(c.bolo.formatos || []).length ? campo('edF' + k, 'Formato', `<select class="sel" id="edF${k}" data-np="formato">${sel([...(it && !it.formato ? [['', 'Não informado']] : []), ...c.bolo.formatos.map(ff => [ff.slug, ff.nome])], formatoSlug(it?.formato))}</select>`) : ''}
        ${campo('edS' + k, '2º recheio', `<select class="sel" id="edS${k}" data-np="seg"><option value="">Sem 2º recheio</option>${sel(bolos.map(b => [b.slug, `${b.rotulo || b.nome} — ${R(b.preco)}/kg`]), segSlug(it?.segundo_recheio))}</select>`)}
        ${!it && finalizacoes.length ? campo('edFin' + k, 'Finalização', `<select class="sel" id="edFin${k}" data-np="fin"><option value="">Tradicional (sem taxa)</option>${finalizacoes.map(f =>
          `<option value="${esc(f.slug)}">${esc(rotuloFinalizacao(f))} (+${esc(R(f.preco))})</option>`).join('')}</select>`) : ''}
      </div>
      <div class="obs-l">${campo('edO' + k, 'Observação do item', `<input class="in" id="edO${k}" data-np="obs" maxlength="1000" value="${esc(ref.texto)}" placeholder="Sabores, escrita no bolo, tema…">`)}
        ${ref.imagem ? `<div class="ed-ref"><img src="${esc(ref.imagem)}" alt=""><span>Imagem de referência anexada</span><button type="button" class="btn sm ghost" data-np="tirar-ref">Remover imagem</button></div>` : ''}</div>
      <div class="ed-preco">${campo('edV' + k, 'Valor de cada', `<div class="money"><input class="in" id="edV${k}" data-np="preco" inputmode="decimal" value="${it ? esc(valorTxt(it.preco_unitario)) : ''}"></div>`)}
        <div class="sub" data-np="sub"></div></div>
    </div>`;
  };
  const m = abrirModal({
    titulo: `Editar ${p.codigo}`,
    largo: true,
    corpo: `<div class="grid2">${inTxt('edNome', 'Cliente', p.cliente_nome, { attrs: 'maxlength="120"' })}${inTxt('edTel', 'Telefone (DDD + número)', formatarTel(p.cliente_telefone) || p.cliente_telefone || '', { attrs: ATTR_TEL })}</div>
      <div class="grid3">${inSel('edOrig', 'Pedido feito por', Object.entries(ORIGENS), p.origem || 'backoffice')}
        ${campo('edData', 'Data da retirada', `<input class="in" id="edData" type="date" value="${esc(p.data_retirada)}">`)}
        ${campo('edHora', 'Horário', `<input class="in" id="edHora" type="time" value="${esc(hora(p.hora_retirada))}">`)}</div>
      ${inTa('edObs', 'Observação do cliente', p.observacao_cliente || '', { attrs: 'maxlength="1000" style="min-height:60px"' })}
      <p class="secao-t">Itens</p>
      <div id="edItens">${itensOrig.length ? itensOrig.map(linha).join('') : linha()}</div>
      <button type="button" class="btn ghost sm" data-np="add">${ic('mais')}Adicionar item</button>
      <div class="grid2" style="margin-top:14px;align-items:end">
        ${inDin('edDesc', 'Desconto', p.desconto || '')}
        <div class="np-total" style="margin:0 0 14px"><span>Novo total</span><span id="edTotal"></span></div>
      </div>
      <p class="dica" style="margin:0">Ao mudar produto, peso ou 2º recheio, o valor é recalculado pelo cardápio; você pode ajustar o valor de cada item à mão. O total, o sinal e o saldo são atualizados ao salvar. Pagamentos e status continuam nos botões do pedido.</p>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar alterações</button>`
  });
  const campoDe = (box, nome) => box.querySelector(`[data-np="${nome}"]`);
  // seleciona o produto de cada item já gravado (as opções são as mesmas para todas as linhas)
  m.$$('.np-item[data-id]').forEach(box => { const it = itensOrig.find(i => i.id === box.dataset.id), prod = porId[it?.produto_id]; if (prod) campoDe(box, 'prod').value = prod.slug; });
  const sugerido = box => {
    const prod = prods[campoDe(box, 'prod').value]; if (!prod) return null;
    const qtd = Math.max(1, parseInt(campoDe(box, 'qtd').value, 10) || 1);
    return precoUnitario(prod, { qtd, peso: campoDe(box, 'peso').value, seg: prods[campoDe(box, 'seg').value] });
  };
  const atualizar = () => {
    let sub = 0;
    m.$$('.np-item').forEach(box => {
      const prod = prods[campoDe(box, 'prod').value];
      box.querySelector('.bolo').hidden = !(prod && prod.tipo === 'bolo');
      const q = Math.max(1, parseInt(campoDe(box, 'qtd').value, 10) || 1), v = lerValor(campoDe(box, 'preco').value) || 0;
      const fin = prods[campoDe(box, 'fin')?.value];
      const linhaTot = q * v + (fin ? q * Number(fin.preco) : 0);
      const vazio = !prod && !box.dataset.id;
      box.querySelector('[data-np="sub"]').innerHTML = vazio ? '' : `${q} × ${R(v)}${fin ? ` + finalização ${R(q * Number(fin.preco))}` : ''} = <strong>${R(linhaTot)}</strong>`;
      if (!vazio) sub += linhaTot;
    });
    const desc = Math.max(0, lerValor(valDe(m, 'edDesc')) || 0);
    m.$('#edTotal').textContent = R(Math.max(0, Math.round((sub - desc) * 100) / 100));
  };
  // muda o produto, o peso ou o 2º recheio: valor pelo cardápio; quantidade só muda o valor quando o produto tem faixa de preço e o valor não foi digitado
  m.el.addEventListener('change', e => {
    const box = e.target.closest('.np-item'), np = e.target.dataset.np;
    if (box && ['prod', 'peso', 'seg'].includes(np)) { const s = sugerido(box); if (s != null) { campoDe(box, 'preco').value = valorTxt(s); delete campoDe(box, 'preco').dataset.manual; } }
    atualizar();
  });
  m.el.addEventListener('input', e => {
    const box = e.target.closest('.np-item'), np = e.target.dataset.np;
    if (np === 'preco') campoDe(box, 'preco').dataset.manual = '1';
    if (np === 'qtd') {
      const prod = prods[campoDe(box, 'prod').value], pr = campoDe(box, 'preco');
      if (prod && (prod.faixas_preco || []).length && !pr.dataset.manual) { const s = sugerido(box); if (s != null) pr.value = valorTxt(s); }
    }
    if (['qtd', 'preco'].includes(np) || e.target.id === 'edDesc') atualizar();
  });
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-np]'); if (!b) return;
    if (b.dataset.np === 'add') { m.$('#edItens').insertAdjacentHTML('beforeend', linha()); m.$('#edItens .np-item:last-child select').focus(); atualizar(); }
    if (b.dataset.np === 'tirar') { b.closest('.np-item').remove(); atualizar(); }
    if (b.dataset.np === 'tirar-ref') { b.closest('.np-item').dataset.ref = ''; b.closest('.ed-ref').remove(); }
  });
  atualizar();

  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'edNome', 'Informe o nome do cliente.');
    if (!telOk(valDe(m, 'edTel'))) throw new Error('Telefone incompleto: informe DDD + número, ex.: (19) 99999-9999.');
    exigir(m, 'edData', 'Informe a data da retirada.');
    const desc = lerValor(valDe(m, 'edDesc')) || 0;
    if (Number.isNaN(desc) || desc < 0) throw new Error('Desconto inválido.');
    // monta os itens como vão para o banco (pedido_itens)
    const linhas = [];
    m.$$('.np-item').forEach(box => {
      const id = box.dataset.id || null, prod = prods[campoDe(box, 'prod').value];
      if (!id && !prod) return;   // linha nova sem produto escolhido
      const quantidade = parseInt(campoDe(box, 'qtd').value, 10);
      const nomeItem = prod?.nome || itensOrig.find(i => i.id === id)?.nome || 'item';
      if (!(quantidade >= 1 && quantidade <= 999)) throw new Error(`Quantidade inválida em "${nomeItem}".`);
      const preco = lerValor(campoDe(box, 'preco').value);
      if (preco == null || Number.isNaN(preco) || preco < 0) throw new Error(`Informe o valor de "${nomeItem}".`);
      const d = { quantidade, preco_unitario: Math.round(preco * 100) / 100, observacao: juntarReferencia(campoDe(box, 'obs').value, box.dataset.ref) };
      if (prod) {
        Object.assign(d, { produto_id: prod.id, categoria: prod.categoria, nome: prod.nome, peso_kg: null, preco_kg: null, massa: null, formato: null,
          segundo_recheio_id: null, segundo_recheio: null, faixa_preco: null });
        if (prod.tipo === 'bolo') {
          const peso = Number(campoDe(box, 'peso').value), seg = prods[campoDe(box, 'seg').value];
          if (seg && seg.id === prod.id) throw new Error(`O 2º recheio precisa ser diferente do sabor principal em "${prod.nome}".`);
          Object.assign(d, { peso_kg: peso, preco_kg: peso ? Math.round(d.preco_unitario / peso * 100) / 100 : null,
            massa: c.bolo.massas.find(x => x.slug === campoDe(box, 'massa').value)?.nome || null,
            formato: (c.bolo.formatos || []).find(x => x.slug === campoDe(box, 'formato')?.value)?.nome || null,
            segundo_recheio_id: seg?.id || null, segundo_recheio: seg ? (seg.rotulo || seg.nome) : null });
        } else {
          const f = (prod.faixas_preco || []).filter(x => quantidade >= x.quantidade_minima && (x.quantidade_maxima == null || quantidade <= x.quantidade_maxima)).sort((a, b) => b.quantidade_minima - a.quantidade_minima)[0];
          if (f && Number(f.preco) === d.preco_unitario) d.faixa_preco = f.nome;
        }
      }
      linhas.push({ id, d });
      const fin = prods[campoDe(box, 'fin')?.value];
      if (fin && prod) linhas.push({ id: null, d: { quantidade, preco_unitario: Number(fin.preco), observacao: `Bolo: ${prod.nome} ${formatarPeso(d.peso_kg)}`,
        produto_id: fin.id, categoria: fin.categoria, nome: fin.nome, peso_kg: null, preco_kg: null, massa: null, formato: null,
        segundo_recheio_id: null, segundo_recheio: null, faixa_preco: null } });
    });
    if (!linhas.length) throw new Error('O pedido precisa ter pelo menos um item.');
    linhas.forEach((l, i) => { l.d.ordem = i + 1; });
    // só grava o que mudou
    const mesmo = (a, b) => String(a ?? '') === String(b ?? '') || (a != null && b != null && a !== '' && b !== '' && Number(a) === Number(b));
    const mudou = l => {
      const o = itensOrig.find(i => i.id === l.id), pos = itensOrig.indexOf(o) + 1;
      return pos !== l.d.ordem || Object.keys(l.d).some(k => !['ordem', 'segundo_recheio_id'].includes(k) && !mesmo(o[k], l.d[k]));
    };
    const ficam = new Set(linhas.filter(l => l.id).map(l => l.id));
    const removidos = itensOrig.filter(i => !ficam.has(i.id));
    const alterados = linhas.filter(l => l.id && mudou(l)), novos = linhas.filter(l => !l.id);
    const dados = { cliente_nome: valDe(m, 'edNome'), cliente_telefone: formatarTel(valDe(m, 'edTel')) || null, origem: valDe(m, 'edOrig'),
      data_retirada: valDe(m, 'edData'), hora_retirada: valDe(m, 'edHora') || null, desconto: desc, observacao_cliente: valDe(m, 'edObs') || null };
    m.fechar();
    await acaoGaveta(null, async () => {
      const itensApi = api.admin.pedidos.itens;
      for (const i of removidos) await itensApi.remover(i.id);
      for (const l of alterados) await itensApi.atualizar(l.id, l.d);
      for (const l of novos) await itensApi.criar({ ...l.d, pedido_id: p.id });
      const r = await api.admin.pedidos.atualizar(p.id, dados);   // por último: o total, o sinal e o saldo são recalculados com os itens novos
      const nItens = removidos.length + alterados.length + novos.length;
      toast(nItens ? `Pedido atualizado (${nItens} ${nItens === 1 ? 'item alterado' : 'itens alterados'}).` : 'Pedido atualizado.');
      return r;
    });
  }));
}

/* =========================================================
   NOVO PEDIDO (pedido feito por WhatsApp, telefone ou balcão)
========================================================= */
let cardapioAtivo = null;
/** Finalização do bolo (colorido, glitter…): produto do grupo "Finalização" (ou com slug "finalizacao-…"), cobrado à parte. */
const ehFinalizacao = p => /^finalizacao-/.test(p?.slug || '')
  || /^finaliza/.test(String(p?.grupo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());
const rotuloFinalizacao = p => p.rotulo || String(p.nome).replace(/^finaliza[çc][ãa]o\s*/i, '').replace(/^./, c => c.toUpperCase());
/** Produtos do cardápio para montar itens de pedido (Novo pedido e Editar pedido). */
function catalogoPedido(c) {
  const prods = {};
  const grupos = c.categorias.map(cat => ({ nome: cat.nome + (cat.aceita_pedido_online === false && cat.layout !== 'pagina' ? ' (só backoffice)' : ''),
    itens: [...cat.grupos.flatMap(g => g.produtos.map(p => ({ ...p, grupo: g.nome, categoria: cat.nome }))), ...cat.produtos.map(p => ({ ...p, categoria: cat.nome }))] }))
    .filter(g => g.itens.length);
  grupos.forEach(g => g.itens.forEach(p => { prods[p.slug] = p; }));
  const bolos = Object.values(prods).filter(p => p.tipo === 'bolo');
  // Finalização do bolo (colorido, glitter…): opção dentro do bolo (vira item à parte) e também item avulso na lista de produtos
  const finalizacoes = Object.values(prods).filter(ehFinalizacao);
  const opcoesProd = `<option value="">Escolha um produto</option>` + grupos.map(g => `<optgroup label="${esc(g.nome)}">${g.itens.map(p =>
    `<option value="${esc(p.slug)}">${esc(p.nome)} — ${esc(R(p.preco))}${p.unidade_preco === 'kg' ? '/kg' : ''}</option>`).join('')}</optgroup>`).join('');
  /** Preço de uma unidade pelo cardápio: bolo = R$/kg (o maior entre os dois recheios) × peso; demais = faixa de quantidade ou preço base. */
  const precoUnitario = (p, { qtd = 1, peso, seg } = {}) => {
    if (!p) return 0;
    if (p.tipo === 'bolo') return Math.round(Math.max(Number(p.preco), seg ? Number(seg.preco) : 0) * Number(peso || 0) * 100) / 100;
    const f = (p.faixas_preco || []).filter(x => qtd >= x.quantidade_minima && (x.quantidade_maxima == null || qtd <= x.quantidade_maxima)).sort((a, b) => b.quantidade_minima - a.quantidade_minima)[0];
    return Number(f ? f.preco : p.preco);
  };
  return { prods, bolos, finalizacoes, opcoesProd, precoUnitario };
}
async function carregarCardapioAtivo(forcar = false) {
  if (!cardapioAtivo || forcar) cardapioAtivo = await api.cardapio.obter();
  return cardapioAtivo;
}
let cacheLoja = null;
async function configLoja(forcar = false) {
  if (!cacheLoja || forcar) { try { cacheLoja = await api.admin.configuracoes.obter(); } catch (e) { cacheLoja = null; } }
  return cacheLoja;
}
async function modalNovoPedido() {
  let c;
  try { c = await carregarCardapioAtivo(true); } catch (e) { erroToast(e); return; }
  const { prods, bolos, finalizacoes, opcoesProd } = catalogoPedido(c);
  let n = 0;
  const linha = () => {
    const k = ++n;
    return `<div class="np-item" data-k="${k}">
      ${campo('npP' + k, 'Produto', `<select class="sel" id="npP${k}" data-np="prod">${opcoesProd}</select>`)}
      ${campo('npQ' + k, 'Qtd.', `<input class="in" id="npQ${k}" data-np="qtd" type="number" min="1" max="999" value="1" inputmode="numeric">`)}
      <button type="button" class="btn icon ghost" data-np="tirar" aria-label="Tirar item" style="align-self:end">${ic('lixo')}</button>
      <div class="bolo" hidden>
        ${campo('npW' + k, 'Peso', `<select class="sel" id="npW${k}" data-np="peso">${c.bolo.pesos.map(w => `<option value="${w}">${esc(formatarPeso(w))}</option>`).join('')}</select>`)}
        ${campo('npM' + k, 'Massa', `<select class="sel" id="npM${k}" data-np="massa">${c.bolo.massas.map(mm => `<option value="${esc(mm.slug)}">${esc(mm.nome)}</option>`).join('')}</select>`)}
        ${(c.bolo.formatos || []).length ? campo('npF' + k, 'Formato', `<select class="sel" id="npF${k}" data-np="formato">${c.bolo.formatos.map(ff => `<option value="${esc(ff.slug)}">${esc(ff.nome)}</option>`).join('')}</select>`) : ''}
        ${campo('npS' + k, '2º recheio', `<select class="sel" id="npS${k}" data-np="seg"><option value="">Sem 2º recheio</option>${bolos.map(b => `<option value="${esc(b.slug)}">${esc(b.rotulo)} — ${esc(R(b.preco))}/kg</option>`).join('')}</select>`)}
        ${finalizacoes.length ? campo('npFin' + k, 'Finalização', `<select class="sel" id="npFin${k}" data-np="fin"><option value="">Tradicional (sem taxa)</option>${finalizacoes.map(f =>
          `<option value="${esc(f.slug)}">${esc(rotuloFinalizacao(f))} (+${esc(R(f.preco))})</option>`).join('')}</select>`) : ''}
      </div>
      <div class="obs-l">${campo('npO' + k, 'Observação do item', `<input class="in" id="npO${k}" data-np="obs" maxlength="1000" placeholder="Sabores, escrita no bolo, tema…">`)}</div>
      <div class="sub" data-np="sub"></div>
    </div>`;
  };
  const m = abrirModal({
    titulo: 'Novo pedido',
    largo: true,
    corpo: `<div class="np-concl">
        ${inChk('npConcl', '<span><strong>Pedido já concluído</strong><small>Para lançar um pedido que já foi retirado e pago: ele entra como retirado e 100% pago.</small></span>')}
        <div class="np-concl-op" hidden>${inSel('npForma', 'Como foi pago', Object.entries(FORMAS), 'pix')}</div>
      </div>
      <div class="grid2">${inTxt('npNome', 'Cliente', '', { attrs: 'maxlength="120" autocomplete="off"' })}${inTxt('npTel', 'Telefone (DDD + número)', '', { attrs: ATTR_TEL })}</div>
      <div class="grid3">${inSel('npOrig', 'Pedido feito por', [['whatsapp', 'WhatsApp'], ['balcao', 'Balcão'], ['backoffice', 'Outro']], 'whatsapp')}
        ${campo('npData', 'Data da retirada', `<input class="in" id="npData" type="date" value="${hojeISO(Number(c.configuracoes?.dias_retirada_sugerida ?? 2))}">`)}
        ${campo('npHora', 'Horário', `<input class="in" id="npHora" type="time" value="${esc(hora(c.configuracoes?.hora_retirada_sugerida || '10:00'))}">`)}</div>
      ${inTxt('npObs', 'Observação geral <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', '', { attrs: 'maxlength="1000"' })}
      <p class="secao-t">Itens</p>
      <div id="npItens">${linha()}</div>
      <button type="button" class="btn ghost sm" data-np="add">${ic('mais')}Adicionar item</button>
      <div class="np-total"><span>Total estimado</span><span id="npTotal">${R(0)}</span></div>
      <p class="dica" style="margin:0">Os preços são confirmados pelo sistema ao salvar.</p>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Criar pedido</button>`
  });
  const precoItem = box => {
    const p = prods[box.querySelector('[data-np="prod"]').value]; if (!p) return 0;
    const q = Math.max(1, parseInt(box.querySelector('[data-np="qtd"]').value, 10) || 1);
    if (p.tipo === 'bolo') {
      const seg = prods[box.querySelector('[data-np="seg"]').value];
      const kg = Math.max(p.preco, seg ? seg.preco : 0);
      const fin = prods[box.querySelector('[data-np="fin"]')?.value];
      return (Math.round(kg * Number(box.querySelector('[data-np="peso"]').value) * 100) / 100 + (fin ? Number(fin.preco) : 0)) * q;
    }
    const f = (p.faixas_preco || []).filter(x => q >= x.quantidade_minima && (x.quantidade_maxima == null || q <= x.quantidade_maxima)).sort((a, b) => b.quantidade_minima - a.quantidade_minima)[0];
    return (f ? f.preco : p.preco) * q;
  };
  const atualizar = () => {
    let t = 0;
    m.$$('.np-item').forEach(box => {
      const p = prods[box.querySelector('[data-np="prod"]').value];
      box.querySelector('.bolo').hidden = !(p && p.tipo === 'bolo');
      const obs = box.querySelector('[data-np="obs"]');
      obs.placeholder = p?.exemplo_observacao || 'Sabores, escrita no bolo, tema…';
      const v = precoItem(box); t += v;
      box.querySelector('[data-np="sub"]').textContent = p ? R(v) : '';
    });
    m.$('#npTotal').textContent = R(t);
  };
  m.el.addEventListener('change', atualizar);
  m.el.addEventListener('input', e => { if (e.target.dataset.np === 'qtd') atualizar(); });
  // Pedido já concluído: pede a forma de pagamento e a data vira "quando foi retirado" (não pode ser no futuro)
  m.$('#npConcl').addEventListener('change', e => {
    const on = e.target.checked;
    m.$('.np-concl').classList.toggle('on', on);
    m.$('.np-concl-op').hidden = !on;
    m.$('label[for="npData"]').textContent = on ? 'Data em que foi retirado' : 'Data da retirada';
    m.$('#npData').max = on ? hojeISO() : '';
    if (on && valDe(m, 'npData') > hojeISO()) m.$('#npData').value = hojeISO();
    m.$('[data-ok]').textContent = on ? 'Lançar pedido concluído' : 'Criar pedido';
  });
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-np]'); if (!b) return;
    if (b.dataset.np === 'add') { m.$('#npItens').insertAdjacentHTML('beforeend', linha()); m.$('#npItens .np-item:last-child select').focus(); }
    if (b.dataset.np === 'tirar') { if (m.$$('.np-item').length > 1) b.closest('.np-item').remove(); else b.closest('.np-item').querySelector('select').value = ''; atualizar(); }
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'npNome', 'Informe o nome do cliente.');
    if (!telOk(valDe(m, 'npTel'))) throw new Error('Telefone incompleto: informe DDD + número, ex.: (19) 99999-9999.');
    exigir(m, 'npData', 'Informe a data da retirada.');
    const concluido = chkDe(m, 'npConcl');
    if (concluido && valDe(m, 'npData') > hojeISO()) throw new Error('Um pedido já concluído não pode ter a retirada no futuro.');
    const itens = m.$$('.np-item').flatMap(box => {
      const slug = box.querySelector('[data-np="prod"]').value; if (!slug) return [];
      const p = prods[slug];
      const it = { produto_slug: slug, quantidade: parseInt(box.querySelector('[data-np="qtd"]').value, 10) || 1, observacao: box.querySelector('[data-np="obs"]').value.trim() || null, nome: p.nome };
      if (p.tipo !== 'bolo') return [it];
      it.peso_kg = Number(box.querySelector('[data-np="peso"]').value); it.massa = box.querySelector('[data-np="massa"]').value;
      const f = box.querySelector('[data-np="formato"]'); if (f) it.formato = f.value;
      const s = box.querySelector('[data-np="seg"]').value; if (s) it.segundo_recheio_slug = s;
      // a finalização entra como item logo abaixo do bolo, na mesma quantidade
      const fin = prods[box.querySelector('[data-np="fin"]')?.value];
      return fin ? [it, { produto_slug: fin.slug, quantidade: it.quantidade, observacao: `Bolo: ${p.nome} ${formatarPeso(it.peso_kg)}`, nome: fin.nome }] : [it];
    });
    if (!itens.length) throw new Error('Adicione pelo menos um item.');
    const data = valDe(m, 'npData'), horaRet = valDe(m, 'npHora');
    const r = await api.admin.pedidos.criar({ origem: valDe(m, 'npOrig'), cliente_nome: valDe(m, 'npNome'), cliente_telefone: formatarTel(valDe(m, 'npTel')) || null,
      data_retirada: data, hora_retirada: horaRet || null, observacao: valDe(m, 'npObs') || null, itens });
    m.fechar();
    if (concluido) {
      // já nasce pago (100%) e retirado
      try {
        const falta = Math.round((Number(r.total) - Number(r.valor_pago || 0)) * 100) / 100;
        if (falta > 0) await api.admin.pedidos.registrarPagamento(r.id, { valor: falta, forma: valDe(m, 'npForma') || 'pix', tipo: 'outro',
          observacao: 'Pagamento integral (pedido lançado depois de concluído)', pagoEm: `${data}T${horaRet || '12:00'}:00-03:00` });
        const st = statusRetirado();
        if (st) await api.admin.pedidos.alterarStatus(r.id, st.codigo, 'Pedido lançado depois de concluído');
        toast(`Pedido ${r.codigo} lançado como retirado e pago.`);
      } catch (e) {
        console.error(e);
        toast(`Pedido ${r.codigo} criado, mas faltou concluir: ${e?.message || 'erro'}. Registre o pagamento e o status no pedido.`, { tipo: 'erro', tempo: 9000 });
      }
    } else toast(`Pedido ${r.codigo} criado.`);
    precisaRecarregar = true;
    if (telaAtual === 'painel' || telaAtual === 'pedidos') recarregarTela();
    atualizarBadge();
    verPedido(r.id);
  }));
}

/* =========================================================
   CARDÁPIO (categorias, grupos, produtos, preços e fotos)
========================================================= */
const ICONES_CAT = [['bolo', 'Bolo'], ['docinho', 'Docinho'], ['coxinha', 'Salgado'], ['pote', 'Pote'], ['garrafa', 'Garrafa'], ['vela', 'Vela'], ['presente', 'Presente'], ['sacola', 'Sacola']];
const DESENHOS = [['', 'Igual ao da categoria'], ['bolo', 'Bolo'], ['docinho', 'Docinho'], ['pote', 'Bolo no pote'], ['coxinha', 'Coxinha'], ['congelado', 'Salgado congelado'],
  ['esfiha', 'Esfirra'], ['pastel', 'Pastel'], ['churros', 'Churros'], ['pizza', 'Mini pizza'], ['burger', 'Hambúrguer'], ['torta', 'Torta'], ['bolo_salgado', 'Bolo salgado'],
  ['garrafa', 'Garrafa'], ['topper', 'Topo de bolo'], ['vela', 'Vela'], ['guardanapo', 'Guardanapo'], ['garfo', 'Garfinho'], ['copo', 'Copo'], ['prato', 'Pratinho']];
const TIPOS_PROD = [['simples', 'Simples (adiciona direto)'], ['bolo', 'Bolo (peso, massa e 2º recheio; preço por kg)'], ['personalizavel', 'Com observação (sabores, tema...)']];
const UNIDADES = [['unidade', 'unidade'], ['kg', 'kg'], ['cento', 'cento'], ['meio_cento', 'meio cento'], ['pacote', 'pacote'], ['kit', 'kit']];
const SUFIXO_UN = { kg: '/kg', cento: '/cento', meio_cento: '/½ cento', pacote: '/pct', kit: '', unidade: '' };
const LAYOUTS = [['lista', 'Aba do cardápio'], ['grade', 'Tela de kits (cards com foto)'], ['pagina', 'Página separada (link)']];

let CAD = null;          // { categorias, grupos, produtos, faixas }
let catSel = null;
async function carregarCadastro() {
  const [categorias, grupos, produtos, faixas] = await Promise.all([
    api.admin.categorias.listar({ ordenarPor: [['ordem', true], ['nome', true]] }),
    api.admin.grupos.listar({ ordenarPor: [['ordem', true], ['nome', true]] }),
    api.admin.produtos.listar({ ordenarPor: [['ordem', true], ['nome', true]] }),
    api.admin.faixasPreco.listar()
  ]);
  CAD = { categorias, grupos, produtos, faixas };
  cardapioAtivo = null;
  return CAD;
}

async function telaCardapio(el, sub) {
  el.innerHTML = cabecalho('Cardápio', '', 'Categorias, produtos, preços e fotos que aparecem no site.') + '<div class="skel" style="height:46px"></div><div class="skel" style="height:300px;margin-top:14px"></div>';
  try { await carregarCadastro(); } catch (e) { erroToast(e); el.innerHTML = cabecalho('Cardápio', '', 'Categorias, produtos, preços e fotos que aparecem no site.') + `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p></div>`; return; }
  catSel = CAD.categorias.find(c => c.slug === sub) || CAD.categorias.find(c => c.id === catSel?.id) || CAD.categorias[0] || null;
  desenharCardapio();
}
function desenharCardapio() {
  const el = $('#conteudo'); if (telaAtual !== 'cardapio') return;
  const c = catSel;
  const grupos = c ? CAD.grupos.filter(g => g.categoria_id === c.id) : [];
  const prodsDe = gid => CAD.produtos.filter(p => p.categoria_id === c.id && (p.grupo_id || null) === gid);
  const linhaProd = p => {
    const url = p.imagem_path ? api.urlImagem(p.imagem_path) : null;
    const faixas = CAD.faixas.filter(f => f.produto_id === p.id);
    return `<div class="prod ${p.ativo ? '' : 'off'}" data-prod="${esc(p.id)}">
      <span class="thumb">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ic('foto')}</span>
      <span class="p-nome"><strong>${esc(p.rotulo || p.nome)}${p.selo ? `<span class="tag">${esc(p.selo)}</span>` : ''}${p.destaque ? '<span class="tag" style="background:var(--teal-50);color:var(--teal)">Destaque</span>' : ''}</strong>
        <small>${esc(TIPOS_PROD.find(t => t[0] === p.tipo)?.[1].split(' (')[0] || p.tipo)}${faixas.length ? ` · ${faixas.length} faixas de preço` : ''}${p.ativo ? '' : ' · fora do site'}</small></span>
      <span class="preco-in"><span class="money"><label class="sr" for="pr-${esc(p.id)}">Preço de ${esc(p.nome)}</label>
        <input class="in" id="pr-${esc(p.id)}" inputmode="decimal" value="${esc(valorTxt(p.preco))}" data-preco="${esc(p.id)}"></span><small>${esc(SUFIXO_UN[p.unidade_preco] || '')}</small></span>
      <span class="sw"><label class="sr" for="at-${esc(p.id)}">Mostrar ${esc(p.nome)} no site</label><input type="checkbox" class="switch" id="at-${esc(p.id)}" data-ativo-prod="${esc(p.id)}" ${p.ativo ? 'checked' : ''}></span>
      <span class="ed"><button type="button" class="btn icon sm ghost" data-ed-prod="${esc(p.id)}" aria-label="Editar ${esc(p.nome)}">${ic('editar')}</button></span>
    </div>`;
  };
  const blocoGrupo = (g, prods) => `<section class="grupo ${g && !g.ativo ? 'off' : ''}">
      <div class="grupo-h"><h2>${esc(g ? g.nome : 'Sem grupo')}</h2>${g?.info ? `<span class="info">${esc(g.info)}</span>` : ''}
        <span class="acts">${g ? `<button type="button" class="btn sm ghost" data-ed-grupo="${esc(g.id)}">${ic('editar')}Grupo</button>` : ''}
          <button type="button" class="btn sm ghost" data-novo-prod="${esc(g?.id || '')}">${ic('mais')}Produto</button></span></div>
      ${prods.length ? `<div class="prods">${prods.map(linhaProd).join('')}</div>` : '<p class="dica" style="padding:6px 4px;margin:0;color:var(--ink-3)">Nenhum produto neste grupo.</p>'}
    </section>`;
  const semGrupo = c ? prodsDe(null) : [];
  el.innerHTML = cabecalho('Cardápio', `<a class="btn ghost" href="${esc(urlSite())}" target="_blank" rel="noopener">${ic('externo')}Ver no site</a>`, 'Categorias, produtos, preços e fotos que aparecem no site.') + `
    <div class="cat-bar"><div class="chips" role="tablist" aria-label="Categorias">
      ${CAD.categorias.map(x => `<a class="chip ${x.ativo ? '' : 'off'}" role="tab" href="#cardapio/${esc(x.slug)}" aria-pressed="${x.id === c?.id}" aria-selected="${x.id === c?.id}">${esc(x.nome)}</a>`).join('')}</div>
      <button type="button" class="btn sm ghost" data-nova-cat>${ic('mais')}Categoria</button></div>
    ${c ? `<div class="card" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:200px"><strong style="font-size:17px">${esc(c.nome)}</strong>
          <div class="dica" style="color:var(--ink-3);font-weight:400;font-size:13px">${esc(LAYOUTS.find(l => l[0] === c.layout)?.[1] || c.layout)}${c.layout === 'pagina' ? (c.link_externo ? ` · faixa no site levando a ${esc(c.link_externo)}` : ' · fora do cardápio do site (vendida só na página própria)') : ''}${c.antecedencia_minima_dias ? ` · ${c.antecedencia_minima_dias} dias de antecedência` : ''}${c.aceita_pedido_online ? '' : c.layout === 'pagina' ? ' · sem pedido pelo site' : ' · só no backoffice (não aparece no site)'}${c.precos_validos_ate ? ` · preços até ${esc(formatarData(c.precos_validos_ate))}` : ''}</div>
          ${c.precos_validos_ate && c.precos_validos_ate < hojeISO() ? `<div class="tag pend" style="margin-top:6px">A validade dos preços já passou</div>` : ''}</div>
        <label class="chk"><input type="checkbox" class="switch" data-ativo-cat="${esc(c.id)}" ${c.ativo ? 'checked' : ''}> Ativa</label>
        <button type="button" class="btn sm ghost" data-ed-cat="${esc(c.id)}">${ic('editar')}Editar categoria</button>
        <button type="button" class="btn sm ghost" data-novo-grupo>${ic('mais')}Grupo</button>
      </div>
      ${grupos.map(g => blocoGrupo(g, prodsDe(g.id))).join('')}
      ${semGrupo.length || !grupos.length ? blocoGrupo(null, semGrupo) : ''}
      <p class="dica" style="color:var(--ink-3);font-weight:400;font-size:13px">Dica: altere o preço direto no campo e toque fora para salvar. Desligue a chave para tirar um item do site sem apagar.</p>`
    : `<div class="vazio"><h2>Nenhuma categoria</h2><p>Comece criando uma categoria.</p></div>`}`;
}
document.addEventListener('change', async e => {
  if (telaAtual !== 'cardapio' || !CAD) return;
  const t = e.target;
  if (t.dataset.preco) {
    const p = CAD.produtos.find(x => x.id === t.dataset.preco); if (!p) return;
    const v = lerValor(t.value);
    if (v === null || Number.isNaN(v) || v < 0) { toast('Preço inválido. Use números, por exemplo 85,00.', { tipo: 'erro' }); t.value = valorTxt(p.preco); return; }
    if (v === Number(p.preco)) { t.value = valorTxt(v); return; }
    try {
      const r = await api.admin.produtos.atualizar(p.id, { preco: v });
      Object.assign(p, r); t.value = valorTxt(r.preco); t.classList.add('salvo'); setTimeout(() => t.classList.remove('salvo'), 1600);
      toast(`${p.rotulo || p.nome}: ${R(r.preco)}${SUFIXO_UN[p.unidade_preco] || ''}`);
      cardapioAtivo = null;
    } catch (err) { erroToast(err); t.value = valorTxt(p.preco); }
  }
  if (t.dataset.ativoProd) {
    const p = CAD.produtos.find(x => x.id === t.dataset.ativoProd);
    try { Object.assign(p, await api.admin.produtos.alternarAtivo(p.id, t.checked)); t.closest('.prod').classList.toggle('off', !p.ativo); toast(p.ativo ? `${p.rotulo || p.nome} voltou ao site.` : `${p.rotulo || p.nome} saiu do site.`); }
    catch (err) { erroToast(err); t.checked = !t.checked; }
  }
  if (t.dataset.ativoCat) {
    const c = CAD.categorias.find(x => x.id === t.dataset.ativoCat);
    try { Object.assign(c, await api.admin.categorias.atualizar(c.id, { ativo: t.checked })); desenharCardapio(); toast(c.ativo ? `${c.nome} aparece no site.` : `${c.nome} saiu do site.`); }
    catch (err) { erroToast(err); t.checked = !t.checked; }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset?.preco) e.target.blur(); });
document.addEventListener('click', e => {
  if (telaAtual !== 'cardapio' || !CAD) return;
  const b = e.target.closest('[data-ed-prod],[data-novo-prod],[data-ed-grupo],[data-novo-grupo],[data-ed-cat],[data-nova-cat]'); if (!b) return;
  if (b.dataset.edProd) modalProduto(CAD.produtos.find(p => p.id === b.dataset.edProd));
  else if (b.dataset.novoProd !== undefined) modalProduto(null, b.dataset.novoProd || null);
  else if (b.dataset.edGrupo) modalGrupo(CAD.grupos.find(g => g.id === b.dataset.edGrupo));
  else if (b.dataset.novoGrupo !== undefined) modalGrupo(null);
  else if (b.dataset.edCat) modalCategoria(CAD.categorias.find(c => c.id === b.dataset.edCat));
  else if (b.dataset.novaCat !== undefined) modalCategoria(null);
});
async function recarregarCadastro() { await carregarCadastro(); catSel = CAD.categorias.find(c => c.id === catSel?.id) || CAD.categorias[0] || null; desenharCardapio(); }

function modalProduto(p, grupoId = null) {
  const novo = !p;
  const irmaos = CAD.produtos.filter(x => x.categoria_id === catSel?.id && (x.grupo_id || null) === (grupoId || null));
  p = p || { categoria_id: catSel?.id, grupo_id: grupoId, tipo: catSel?.icone === 'bolo' ? 'bolo' : 'simples', unidade_preco: catSel?.icone === 'bolo' ? 'kg' : 'unidade',
    ativo: true, ordem: Math.max(0, ...irmaos.map(x => x.ordem || 0)) + 1, antecedencia_minima_dias: catSel?.antecedencia_minima_dias || 0 };
  const faixas = novo ? [] : CAD.faixas.filter(f => f.produto_id === p.id).sort((a, b) => a.quantidade_minima - b.quantidade_minima);
  const gruposDa = cid => [['', 'Sem grupo'], ...CAD.grupos.filter(g => g.categoria_id === cid).map(g => [g.id, g.nome])];
  const linhaFaixa = (f = {}) => `<div class="fx">
      ${inTxt('', 'Nome', f.nome || '', { attrs: 'data-fx="nome" placeholder="Avulso" maxlength="40"' })}
      ${inNum('', 'De (qtd.)', f.quantidade_minima ?? '', { attrs: 'data-fx="min" min="1"' })}
      ${inNum('', 'Até', f.quantidade_maxima ?? '', { attrs: 'data-fx="max" min="1" placeholder="sem limite"' })}
      ${inDin('', 'Preço un.', f.preco ?? '', { attrs: 'data-fx="preco"' })}
      <button type="button" class="btn icon sm ghost" data-fx-tirar aria-label="Tirar faixa">${ic('lixo')}</button></div>`;
  const il = p.ilustracao || {};
  const m = abrirModal({
    titulo: novo ? 'Novo produto' : 'Editar produto',
    largo: true,
    corpo: `
      <div class="grid2">${inTxt('pNome', 'Nome completo', p.nome || '', { attrs: 'maxlength="120"', dica: 'Aparece no pedido e no recibo. Ex.: Bolo Ninho + Morango' })}
        ${inTxt('pRot', 'Nome curto', p.rotulo || '', { attrs: 'maxlength="80"', dica: 'Aparece dentro do grupo. Ex.: Ninho + Morango' })}</div>
      <div class="grid2">${inSel('pCat', 'Categoria', CAD.categorias.map(c => [c.id, c.nome]), p.categoria_id)}${inSel('pGrupo', 'Grupo', gruposDa(p.categoria_id), p.grupo_id || '')}</div>
      <div class="grid3">${inSel('pTipo', 'Tipo', TIPOS_PROD, p.tipo)}${inDin('pPreco', 'Preço', p.preco ?? '')}${inSel('pUn', 'Cobrado por', UNIDADES, p.unidade_preco)}</div>
      ${inTa('pDesc', 'Descrição <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', p.descricao || '', { attrs: 'maxlength="600" style="min-height:64px"' })}
      <p class="secao-t">Observação do cliente</p>
      <div style="display:flex;gap:18px;flex-wrap:wrap">${inChk('pPede', 'Pedir observação', p.pede_observacao)}${inChk('pObrig', 'Obrigatória', p.observacao_obrigatoria)}</div>
      <div class="grid2">${inTxt('pRotObs', 'Pergunta', p.rotulo_observacao || '', { attrs: 'maxlength="60" placeholder="Ex.: Quais sabores?"' })}${inTxt('pExObs', 'Exemplo', p.exemplo_observacao || '', { attrs: 'maxlength="120" placeholder="Ex.: 40 coxinhas, 30 kibes"' })}</div>
      <p class="secao-t">Aparência</p>
      <div class="grid2">${fotoCampo('pFoto', 'Foto', p.imagem_path)}
        <div>${inSel('pDesenho', 'Desenho (quando não há foto)', DESENHOS, il.tipo || '')}
          <div class="grid2">${inTxt('pSelo', 'Selo', p.selo || '', { attrs: 'maxlength="24" placeholder="Ex.: Novidade"' })}${inSel('pSeloE', 'Cor do selo', [['', 'Padrão'], ['rosa', 'Rosa'], ['dourado', 'Dourado'], ['menta', 'Menta']], p.selo_estilo || '')}</div></div></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:end">${inChk('pDest', 'Mostrar em “Para começar”', p.destaque)}
        <div style="width:150px">${inNum('pDestO', 'Posição no destaque', p.destaque_ordem ?? '', { attrs: 'min="1"' })}</div></div>
      <p class="secao-t">Outros</p>
      <div class="grid3">${inNum('pAnt', 'Antecedência (dias)', p.antecedencia_minima_dias ?? 0, { attrs: 'min="0"' })}${inNum('pOrdem', 'Ordem na lista', p.ordem ?? 0)}
        ${inTxt('pSlug', 'Código', p.slug || '', { attrs: 'maxlength="80" pattern="[a-z0-9-]+"', dica: novo ? 'Gerado pelo nome.' : 'Evite mudar: sacolas abertas usam este código.' })}</div>
      ${inChk('pAtivo', 'Aparece no site', p.ativo)}
      <p class="secao-t">Preço por quantidade <span style="text-transform:none;letter-spacing:0;font-weight:400">(opcional, ex.: atacado)</span></p>
      <p class="dica" style="margin:-4px 0 10px;color:var(--ink-3)">A menor quantidade das faixas vira o pedido mínimo no site (ex.: docinhos “de 20”). Com mínimo de 10 ou mais, o site soma de 10 em 10.</p>
      <div class="faixas" id="pFaixas">${faixas.map(linhaFaixa).join('')}</div>
      <button type="button" class="btn sm ghost" data-fx-add>${ic('mais')}Adicionar faixa</button>`,
    rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
  });
  ligarFotos(m, 'produtos');
  let slugManual = !novo;
  m.$('#pSlug').addEventListener('input', () => { slugManual = true; });
  m.$('#pNome').addEventListener('input', () => { if (!slugManual) m.$('#pSlug').value = slugify(m.$('#pNome').value); });
  m.$('#pCat').addEventListener('change', () => { m.$('#pGrupo').innerHTML = gruposDa(m.$('#pCat').value).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(''); });
  m.$('#pTipo').addEventListener('change', () => { if (m.$('#pTipo').value === 'bolo') m.$('#pUn').value = 'kg'; if (m.$('#pTipo').value === 'personalizavel') m.$('#pPede').checked = true; });
  m.$('#pObrig').addEventListener('change', () => { if (m.$('#pObrig').checked) m.$('#pPede').checked = true; });
  m.$('[data-fx-add]').addEventListener('click', () => m.$('#pFaixas').insertAdjacentHTML('beforeend', linhaFaixa()));
  m.$('#pFaixas').addEventListener('click', e => { if (e.target.closest('[data-fx-tirar]')) e.target.closest('.fx').remove(); });
  m.$('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmar(`Excluir “${p.nome}”?`, 'O produto some do cadastro. Pedidos antigos continuam com o nome e o preço da época. Se for algo temporário, prefira desligar a chave “Aparece no site”.', { botao: 'Excluir', perigo: true })) return;
    await ocupado(m.$('[data-del]'), async () => { await api.admin.produtos.remover(p.id); m.fechar(); toast('Produto excluído.'); await recarregarCadastro(); });
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'pNome', 'Informe o nome do produto.');
    const preco = lerValor(valDe(m, 'pPreco'));
    if (preco === null || Number.isNaN(preco) || preco < 0) { m.$('#pPreco').setAttribute('aria-invalid', 'true'); m.$('#pPreco').focus(); throw new Error('Informe um preço válido, por exemplo 85,00.'); }
    const slug = slugify(valDe(m, 'pSlug') || valDe(m, 'pNome'));
    if (!slug) throw new Error('Informe um código válido.');
    const desenho = valDe(m, 'pDesenho');
    const dados = {
      nome: valDe(m, 'pNome'), rotulo: valDe(m, 'pRot') || null, categoria_id: valDe(m, 'pCat'), grupo_id: valDe(m, 'pGrupo') || null,
      tipo: valDe(m, 'pTipo'), preco, unidade_preco: valDe(m, 'pUn'), descricao: valDe(m, 'pDesc') || null,
      pede_observacao: chkDe(m, 'pPede') || chkDe(m, 'pObrig'), observacao_obrigatoria: chkDe(m, 'pObrig'),
      rotulo_observacao: valDe(m, 'pRotObs') || null, exemplo_observacao: valDe(m, 'pExObs') || null,
      imagem_path: fotoDe(m, 'pFoto'), ilustracao: desenho ? (desenho === il.tipo ? il : { tipo: desenho }) : null,
      selo: valDe(m, 'pSelo') || null, selo_estilo: valDe(m, 'pSeloE') || null,
      destaque: chkDe(m, 'pDest'), destaque_ordem: numDe(m, 'pDestO'), antecedencia_minima_dias: numDe(m, 'pAnt') || 0, ordem: numDe(m, 'pOrdem') || 0,
      slug, ativo: chkDe(m, 'pAtivo')
    };
    if (dados.unidade_preco === 'cento') dados.quantidade_por_unidade = 100;
    else if (dados.unidade_preco === 'meio_cento') dados.quantidade_por_unidade = 50;
    else if (p.unidade_preco !== dados.unidade_preco) dados.quantidade_por_unidade = null;
    // faixas
    const novas = m.$$('#pFaixas .fx').map(fx => ({
      nome: fx.querySelector('[data-fx="nome"]').value.trim(), quantidade_minima: parseInt(fx.querySelector('[data-fx="min"]').value, 10),
      quantidade_maxima: fx.querySelector('[data-fx="max"]').value ? parseInt(fx.querySelector('[data-fx="max"]').value, 10) : null,
      preco: lerValor(fx.querySelector('[data-fx="preco"]').value)
    }));
    for (const f of novas) {
      if (!f.nome || !(f.quantidade_minima >= 1) || f.preco === null || Number.isNaN(f.preco)) throw new Error('Preencha nome, quantidade inicial e preço de cada faixa.');
      if (f.quantidade_maxima !== null && f.quantidade_maxima < f.quantidade_minima) throw new Error(`Na faixa “${f.nome}”, o “até” é menor que o “de”.`);
    }
    if (new Set(novas.map(f => f.quantidade_minima)).size !== novas.length) throw new Error('Duas faixas começam na mesma quantidade.');
    const salvo = novo ? await api.admin.produtos.criar(dados) : await api.admin.produtos.atualizar(p.id, dados);
    for (const f of faixas) await api.admin.faixasPreco.remover(f.id);
    for (const f of novas) await api.admin.faixasPreco.criar({ ...f, produto_id: salvo.id });
    m.fechar();
    toast(novo ? 'Produto criado.' : 'Produto salvo.');
    catSel = CAD.categorias.find(c => c.id === salvo.categoria_id) || catSel;
    await recarregarCadastro();
  }));
}

function modalGrupo(g) {
  const novo = !g;
  g = g || { categoria_id: catSel?.id, ativo: true, ordem: (CAD.grupos.filter(x => x.categoria_id === catSel?.id).length + 1) };
  const m = abrirModal({
    titulo: novo ? 'Novo grupo' : 'Editar grupo',
    corpo: `${inTxt('gNome', 'Nome', g.nome || '', { attrs: 'maxlength="60"', dica: 'Ex.: Ninho, Brigadeiro, Mini salgados fritos' })}
      ${inSel('gCat', 'Categoria', CAD.categorias.map(c => [c.id, c.nome]), g.categoria_id)}
      ${inTxt('gInfo', 'Informação curta', g.info || '', { attrs: 'maxlength="40" placeholder="Ex.: 100 unidades"' })}
      ${inTa('gSab', 'Sabores', g.sabores || '', { attrs: 'maxlength="600" style="min-height:64px"', dica: 'Aparece embaixo do título, para grupos como salgados.' })}
      <div class="grid2">${inNum('gOrdem', 'Ordem', g.ordem ?? 0)}<div style="align-self:center">${inChk('gAtivo', 'Aparece no site', g.ativo)}</div></div>`,
    rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
  });
  m.$('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmar(`Excluir o grupo “${g.nome}”?`, 'Só dá para excluir um grupo vazio. Mova ou exclua os produtos dele antes.', { botao: 'Excluir', perigo: true })) return;
    await ocupado(m.$('[data-del]'), async () => { await api.admin.grupos.remover(g.id); m.fechar(); toast('Grupo excluído.'); await recarregarCadastro(); });
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'gNome', 'Informe o nome do grupo.');
    const dados = { nome: valDe(m, 'gNome'), categoria_id: valDe(m, 'gCat'), info: valDe(m, 'gInfo') || null, sabores: valDe(m, 'gSab') || null, ordem: numDe(m, 'gOrdem') || 0, ativo: chkDe(m, 'gAtivo') };
    if (!novo && dados.categoria_id !== g.categoria_id && CAD.produtos.some(p => p.grupo_id === g.id)) throw new Error('Este grupo tem produtos. Para mudar de categoria, mova os produtos antes.');
    if (novo) await api.admin.grupos.criar(dados); else await api.admin.grupos.atualizar(g.id, dados);
    m.fechar(); toast('Grupo salvo.'); await recarregarCadastro();
  }));
}

function modalCategoria(c) {
  const novo = !c;
  c = c || { layout: 'lista', ativo: true, aceita_pedido_online: true, antecedencia_minima_dias: 0, ordem: CAD.categorias.length + 1, icone: 'presente' };
  const m = abrirModal({
    titulo: novo ? 'Nova categoria' : 'Editar categoria',
    largo: true,
    corpo: `<div class="grid2">${inTxt('cNome', 'Nome', c.nome || '', { attrs: 'maxlength="40"' })}${inTxt('cSlug', 'Código (endereço)', c.slug || '', { attrs: 'maxlength="40"', dica: 'Usado no link: #cardapio/<código>' })}</div>
      <div class="grid2">${inSel('cLayout', 'Onde aparece', LAYOUTS, c.layout)}${inSel('cIcone', 'Desenho', ICONES_CAT, c.icone || 'presente')}</div>
      ${inTa('cIntro', 'Aviso no topo da categoria', c.introducao || '', { attrs: 'maxlength="400" style="min-height:64px"' })}
      ${inTxt('cAviso', 'Nota no rodapé', c.aviso || '', { attrs: 'maxlength="200" placeholder="Ex.: Imagens meramente ilustrativas."' })}
      <div class="grid3">${inNum('cAnt', 'Antecedência (dias)', c.antecedencia_minima_dias ?? 0, { attrs: 'min="0"' })}
        ${campo('cVal', 'Preços válidos até', `<input class="in" id="cVal" type="date" value="${esc(c.precos_validos_ate || '')}">`)}${inNum('cOrdem', 'Ordem', c.ordem ?? 0)}</div>
      <div id="cPagina" ${c.layout === 'pagina' ? '' : 'hidden'}>
        ${inTa('cDesc', 'Descrição', c.descricao || '', { attrs: 'maxlength="800" style="min-height:64px"' })}
        <div class="grid2">${inTxt('cLink', 'Link da página', c.link_externo || '', { attrs: 'placeholder="sacolinhas.html"', dica: 'Os produtos são vendidos só na página própria, nunca no cardápio. Com link, aparece uma faixa no início do site; sem link, a categoria fica fora do site (ex.: atacado, vendido só na página do bolo no pote).' })}${inTxt('cParc', 'Parceria', c.parceiro || '', { attrs: 'maxlength="60"' })}</div>
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap">${inChk('cOnline', 'Vende pelo site', c.aceita_pedido_online)}${inChk('cAtivo', 'Ativa', c.ativo)}</div>
      <p class="dica" style="margin:4px 0 0">Desmarque <strong>Vende pelo site</strong> para itens só do backoffice (ex.: pedidos personalizados para algumas clientes): a categoria some do site e os itens só podem ser lançados em <strong>Novo pedido</strong>. Desmarque <strong>Ativa</strong> para tirar a categoria de tudo.</p>`,
    rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
  });
  let slugManual = !novo;
  m.$('#cSlug').addEventListener('input', () => { slugManual = true; });
  m.$('#cNome').addEventListener('input', () => { if (!slugManual) m.$('#cSlug').value = slugify(m.$('#cNome').value); });
  m.$('#cLayout').addEventListener('change', () => { m.$('#cPagina').hidden = m.$('#cLayout').value !== 'pagina'; });
  m.$('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmar(`Excluir “${c.nome}”?`, 'Só dá para excluir uma categoria sem produtos. Para esconder do site, desligue “Aparece no site”.', { botao: 'Excluir', perigo: true })) return;
    await ocupado(m.$('[data-del]'), async () => { await api.admin.categorias.remover(c.id); m.fechar(); toast('Categoria excluída.'); catSel = null; await recarregarCadastro(); });
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'cNome', 'Informe o nome da categoria.');
    const slug = slugify(valDe(m, 'cSlug') || valDe(m, 'cNome'));
    const dados = { nome: valDe(m, 'cNome'), slug, layout: valDe(m, 'cLayout'), icone: valDe(m, 'cIcone'), introducao: valDe(m, 'cIntro') || null, aviso: valDe(m, 'cAviso') || null,
      antecedencia_minima_dias: numDe(m, 'cAnt') || 0, precos_validos_ate: valDe(m, 'cVal') || null, ordem: numDe(m, 'cOrdem') || 0,
      descricao: valDe(m, 'cDesc') || null, link_externo: valDe(m, 'cLink') || null, parceiro: valDe(m, 'cParc') || null,
      aceita_pedido_online: chkDe(m, 'cOnline'), ativo: chkDe(m, 'cAtivo') };
    if (dados.layout === 'pagina' && !dados.link_externo) throw new Error('Informe o link da página.');
    const r = novo ? await api.admin.categorias.criar(dados) : await api.admin.categorias.atualizar(c.id, dados);
    m.fechar(); toast('Categoria salva.');
    catSel = r;
    history.replaceState(null, '', '#cardapio/' + r.slug); rotaAtual = 'cardapio/' + r.slug;
    await recarregarCadastro();
  }));
}

/* =========================================================
   AJUSTES (loja, banners, textos, bolos, status, equipe)
========================================================= */
const ABAS = [['loja', 'Loja'], ['banners', 'Banners'], ['textos', 'Textos'], ['bolos', 'Opções de bolo'], ['status', 'Status'], ['equipe', 'Equipe']];
function telaAjustes(el, sub) {
  const aba = ABAS.some(a => a[0] === sub) ? sub : 'loja';
  el.innerHTML = cabecalho('Ajustes', '', 'Loja, banners, textos do site, opções de bolo, status e equipe.') + `<nav class="sub-tabs" aria-label="Seções de ajustes">${ABAS.map(([id, t]) => `<a href="#ajustes/${id}" ${id === aba ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div id="ajConteudo"><div class="skel" style="height:240px"></div></div>`;
  ({ loja: ajLoja, banners: ajBanners, textos: ajTextos, bolos: ajBolos, status: ajStatus, equipe: ajEquipe })[aba]($('#ajConteudo'));
}
const linhaTbl = ({ id, attr, img, cor, titulo, sub, ativo, extra = '' }) => `<div class="r ${ativo === false ? 'off' : ''}">
    ${img !== undefined ? (img ? `<img class="ban-img" src="${esc(img)}" alt="">` : '<span class="ban-img"></span>') : ''}${cor ? `<span class="cor" style="background:${esc(cor)}"></span>` : ''}
    <span class="main"><strong>${esc(titulo)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${extra}
    ${ativo !== undefined ? `<label class="sr" for="sw-${attr}-${esc(id)}">Ativo</label><input type="checkbox" class="switch" id="sw-${attr}-${esc(id)}" data-sw-${attr}="${esc(id)}" ${ativo ? 'checked' : ''}>` : ''}
    <button type="button" class="btn icon sm ghost" data-ed-${attr}="${esc(id)}" aria-label="Editar ${esc(titulo)}">${ic('editar')}</button></div>`;
/** Chaves "ativo" das listas. mapa = { banner: api.admin.banners, ... }. Substitui o tratador anterior (sem acumular). */
function ligarSwitch(box, mapa) {
  box.onchange = async e => {
    for (const [attr, tabela] of Object.entries(mapa)) {
      const id = e.target.dataset['sw' + attr[0].toUpperCase() + attr.slice(1)]; if (id === undefined) continue;
      try { await tabela.atualizar(attr === 'peso' ? Number(id) : id, { ativo: e.target.checked }); e.target.closest('.r').classList.toggle('off', !e.target.checked); cardapioAtivo = null; }
      catch (err) { erroToast(err); e.target.checked = !e.target.checked; }
      return;
    }
  };
}

/* ---- Loja ---- */
async function ajLoja(box) {
  let c;
  const topos = await contatoTopos();
  try { c = await configLoja(true); if (!c) throw new Error('Configurações não encontradas. Rode o seed.sql.'); } catch (e) { box.innerHTML = `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p></div>`; return; }
  box.innerHTML = `
    <div class="pausa ${c.aceitando_pedidos ? 'on' : 'off'}" id="ajPausa">
      <input type="checkbox" class="switch" id="lAceita" ${c.aceitando_pedidos ? 'checked' : ''} aria-describedby="lAceitaTxt">
      <label for="lAceita" style="flex:1;cursor:pointer"><strong>${c.aceitando_pedidos ? 'Recebendo pedidos pelo site' : 'Pedidos pelo site pausados'}</strong>
        <span id="lAceitaTxt">${c.aceitando_pedidos ? 'Desligue para pausar (férias, agenda cheia). O cardápio continua no ar.' : 'Os clientes veem o cardápio, mas não conseguem enviar pedidos.'}</span></label>
    </div>
    <div class="card">
      ${inTa('lPausa', 'Mensagem quando os pedidos estiverem pausados', c.mensagem_pausa || '', { attrs: 'maxlength="300" style="min-height:60px" placeholder="Ex.: Estamos de férias até 10/01. Voltamos logo!"' })}
      <div class="grid2">${inTxt('lNome', 'Nome da loja', c.nome_loja, { attrs: 'maxlength="60"' })}${inTxt('lSlogan', 'Slogan', c.slogan || '', { attrs: 'maxlength="80"' })}</div>
      <div class="grid2">${inTxt('lWa', 'WhatsApp da loja (DDD + número)', formatarTel(c.whatsapp_numero), { attrs: ATTR_TEL.replace('99999-9999', '3845-1550'), dica: 'É o número que recebe os pedidos do site.' })}${inTxt('lWaEx', 'WhatsApp como aparece no site', formatarTel(c.whatsapp_exibicao) || c.whatsapp_exibicao || '', { attrs: ATTR_TEL.replace('99999-9999', '3845-1550'), dica: 'Em branco, usa o mesmo número de cima.' })}</div>
      <div class="grid3">${inNum('lSinal', 'Sinal (%)', c.percentual_sinal, { attrs: 'min="0" max="100" step="1"' })}${inNum('lAnt', 'Antecedência mínima (dias)', c.antecedencia_minima_dias, { attrs: 'min="0"' })}${inNum('lTol', 'Tolerância de peso do bolo (g)', c.tolerancia_peso_bolo_g, { attrs: 'min="0" step="50"' })}</div>
      <div class="grid2">${inNum('lDias', 'Retirada sugerida (dias depois do pedido)', c.dias_retirada_sugerida, { attrs: 'min="0"', dica: 'Só para pedidos lançados aqui pela equipe. No site, o cliente escolhe o dia.' })}${campo('lHora', 'Horário sugerido', `<input class="in" id="lHora" type="time" value="${esc(hora(c.hora_retirada_sugerida))}">`, 'Idem: no site, o cliente escolhe o horário.')}</div>
      ${inTxt('lUrl', 'Endereço do site', c.url_site || '', { attrs: 'type="url" placeholder="https://ritabolos.com.br/"', dica: 'Usado no link do recibo que vai no WhatsApp.' })}
      <div class="grid2">${inTxt('lTopNum', 'WhatsApp de quem faz os topos', formatarTel(topos.numero), { attrs: ATTR_TEL, dica: 'Usado no botão “Enviar para quem faz o topo”, ao lado da imagem de referência.' })}${inTxt('lTopNome', 'Nome de quem faz os topos', topos.nome, { attrs: 'maxlength="60"' })}</div>
      ${fotoCampo('lLogo', 'Logotipo', c.logo_path)}
      <div style="display:flex;justify-content:flex-end"><button type="button" class="btn primary" id="lSalvar">Salvar ajustes</button></div>
    </div>`;
  const fake = { $: s => box.querySelector(s), $$: s => [...box.querySelectorAll(s)] };
  ligarFotos(fake, 'marca');
  box.querySelector('#lAceita').addEventListener('change', async e => {
    const on = e.target.checked;
    try {
      await api.admin.configuracoes.salvar({ aceitando_pedidos: on, mensagem_pausa: valDe(fake, 'lPausa') || null });
      cacheLoja = null; toast(on ? 'Pedidos pelo site liberados.' : 'Pedidos pelo site pausados.'); ajLoja(box);
    } catch (err) { erroToast(err); e.target.checked = !on; }
  });
  box.querySelector('#lSalvar').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    const waDig = digitosTel(valDe(fake, 'lWa'));
    if (waDig.length < 10) throw new Error('Informe o WhatsApp da loja com DDD, ex.: (19) 3845-1550.');
    const wa = '55' + waDig;   // o link do WhatsApp precisa do 55 do Brasil
    const sinal = numDe(fake, 'lSinal');
    if (!(sinal >= 0 && sinal <= 100)) throw new Error('O sinal precisa ficar entre 0 e 100%.');
    exigir(fake, 'lNome', 'Informe o nome da loja.');
    await api.admin.configuracoes.salvar({
      mensagem_pausa: valDe(fake, 'lPausa') || null, nome_loja: valDe(fake, 'lNome'), slogan: valDe(fake, 'lSlogan') || null,
      whatsapp_numero: wa, whatsapp_exibicao: valDe(fake, 'lWaEx') || formatarTel(waDig), percentual_sinal: sinal,
      antecedencia_minima_dias: numDe(fake, 'lAnt') || 0, tolerancia_peso_bolo_g: numDe(fake, 'lTol') || 0,
      dias_retirada_sugerida: numDe(fake, 'lDias') || 0, hora_retirada_sugerida: valDe(fake, 'lHora') || '10:00',
      url_site: valDe(fake, 'lUrl') || null, logo_path: fotoDe(fake, 'lLogo')
    });
    const topNum = digitosTel(valDe(fake, 'lTopNum'));
    if (topNum && topNum.length < 10) throw new Error('Informe o WhatsApp de quem faz os topos com DDD.');
    await salvarContatoTopos(topNum, valDe(fake, 'lTopNome'));
    cacheLoja = null; cardapioAtivo = null; toast('Ajustes salvos. O site já mostra as mudanças.');
  }));
}

/* ---- Banners ---- */
async function ajBanners(box) {
  let lista, cats;
  try { [lista, cats] = await Promise.all([api.admin.banners.listar(), api.admin.categorias.listar()]); } catch (e) { erroToast(e); return; }
  const periodo = b => b.inicio_em || b.fim_em ? `${b.inicio_em ? 'de ' + dataHora(b.inicio_em) : ''}${b.fim_em ? ' até ' + dataHora(b.fim_em) : ''}` : 'sempre';
  box.innerHTML = `<div class="page-head" style="margin-bottom:10px"><p class="dica" style="margin:0;color:var(--ink-2);font-weight:400">Carrossel da tela inicial do site.</p>
      <button type="button" class="btn primary sm" data-novo-banner>${ic('mais')}Banner</button></div>
    <div class="tbl">${lista.length ? lista.map(b => linhaTbl({ id: b.id, attr: 'banner', img: b.imagem_path ? api.urlImagem(b.imagem_path) : null, titulo: b.titulo, sub: `${b.subtitulo || ''} · ${periodo(b)}`, ativo: b.ativo })).join('') : '<div class="r"><span class="main">Nenhum banner.</span></div>'}</div>`;
  ligarSwitch(box, { banner: api.admin.banners });
  box.onclick = e => {
    const b = e.target.closest('[data-ed-banner],[data-novo-banner]'); if (!b) return;
    modalBanner(lista.find(x => x.id === b.dataset.edBanner) || null, cats, () => ajBanners(box));
  };
}
function modalBanner(b, cats, depois) {
  const novo = !b;
  b = b || { estilo: 'chocolate', ativo: true, ordem: 0, link: '#cardapio/bolos' };
  const destinos = [...cats.filter(c => c.ativo).map(c => [c.layout === 'grade' ? '#kits' : c.layout === 'pagina' ? (c.link_externo || '') : '#cardapio/' + c.slug, c.nome]), ['#ajuda', 'Ajuda / como pedir']].filter(d => d[0]);
  const ehOutro = b.link && !destinos.some(d => d[0] === b.link);
  const local = iso => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
  const m = abrirModal({
    titulo: novo ? 'Novo banner' : 'Editar banner', largo: true,
    corpo: `<div class="grid2">${inTxt('bTit', 'Título', b.titulo || '', { attrs: 'maxlength="60"' })}${inTxt('bSub', 'Subtítulo', b.subtitulo || '', { attrs: 'maxlength="100"' })}</div>
      <div class="grid3">${inTxt('bBt', 'Texto do botão', b.texto_botao || '', { attrs: 'maxlength="24" placeholder="Ex.: Ver bolos"' })}
        ${inSel('bLink', 'Botão leva para', [...destinos, ['__outro', 'Outro endereço…']], ehOutro ? '__outro' : b.link || '')}
        ${inSel('bEst', 'Cor de fundo', [['chocolate', 'Chocolate'], ['menta', 'Menta'], ['rosa', 'Rosa']], b.estilo)}</div>
      <div id="bOutroBox" ${ehOutro ? '' : 'hidden'}>${inTxt('bOutro', 'Endereço', ehOutro ? b.link : '', { attrs: 'placeholder="https://..."' })}</div>
      <div class="grid2">${fotoCampo('bImg', 'Imagem principal', b.imagem_path)}${fotoCampo('bImg2', 'Segunda imagem (opcional)', b.imagem_secundaria_path)}</div>
      <div class="grid3">${campo('bIni', 'Mostrar a partir de', `<input class="in" id="bIni" type="datetime-local" value="${esc(local(b.inicio_em))}">`)}${campo('bFim', 'Até', `<input class="in" id="bFim" type="datetime-local" value="${esc(local(b.fim_em))}">`)}${inNum('bOrdem', 'Ordem', b.ordem ?? 0)}</div>
      ${inChk('bAtivo', 'Aparece no site', b.ativo)}`,
    rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
  });
  ligarFotos(m, 'banners');
  m.$('#bLink').addEventListener('change', () => { m.$('#bOutroBox').hidden = m.$('#bLink').value !== '__outro'; });
  m.$('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmar('Excluir banner?', `“${b.titulo}” será apagado.`, { botao: 'Excluir', perigo: true })) return;
    await ocupado(m.$('[data-del]'), async () => { await api.admin.banners.remover(b.id); m.fechar(); toast('Banner excluído.'); depois(); });
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'bTit', 'Informe o título.');
    const ini = valDe(m, 'bIni'), fim = valDe(m, 'bFim');
    if (ini && fim && fim <= ini) throw new Error('O fim precisa ser depois do início.');
    const dados = { titulo: valDe(m, 'bTit'), subtitulo: valDe(m, 'bSub') || null, texto_botao: valDe(m, 'bBt') || null,
      link: valDe(m, 'bLink') === '__outro' ? (valDe(m, 'bOutro') || null) : valDe(m, 'bLink') || null, estilo: valDe(m, 'bEst'),
      imagem_path: fotoDe(m, 'bImg'), imagem_secundaria_path: fotoDe(m, 'bImg2'),
      inicio_em: ini ? new Date(ini).toISOString() : null, fim_em: fim ? new Date(fim).toISOString() : null, ordem: numDe(m, 'bOrdem') || 0, ativo: chkDe(m, 'bAtivo') };
    if (novo) await api.admin.banners.criar(dados); else await api.admin.banners.atualizar(b.id, dados);
    m.fechar(); toast('Banner salvo.'); depois();
  }));
}

/* ---- Textos (Como funciona / Bom saber) ---- */
const SECOES = [['como_funciona', 'Como funciona', 'Passos na tela inicial'], ['bom_saber', 'Bom saber', 'Regras na tela Ajuda']];
const ICONES_AVISO = [['', 'Padrão'], ['balanca', 'Balança'], ['presente', 'Presente'], ['camadas', 'Camadas'], ['moedas', 'Moedas'], ['imagem', 'Imagem'], ['calendario', 'Calendário'], ['whatsapp', 'WhatsApp']];
async function ajTextos(box) {
  let lista;
  try { lista = await api.admin.avisos.listar(); } catch (e) { erroToast(e); return; }
  box.innerHTML = SECOES.map(([s, t, d]) => {
    const itens = lista.filter(a => a.secao === s);
    return `<div class="card"><div class="card-h"><div><h2>${t}</h2><span class="dica" style="color:var(--ink-3);font-weight:400;font-size:13px">${d}</span></div>
      <button type="button" class="btn sm primary" data-novo-aviso="${s}">${ic('mais')}Texto</button></div>
      <div class="tbl">${itens.length ? itens.map(a => linhaTbl({ id: a.id, attr: 'aviso', titulo: a.titulo || a.texto, sub: a.titulo ? a.texto : '', ativo: a.ativo })).join('') : '<div class="r"><span class="main">Nenhum texto.</span></div>'}</div></div>`;
  }).join('');
  ligarSwitch(box, { aviso: api.admin.avisos });
  box.onclick = e => {
    const b = e.target.closest('[data-ed-aviso],[data-novo-aviso]'); if (!b) return;
    const a = lista.find(x => x.id === b.dataset.edAviso) || { secao: b.dataset.novoAviso, ativo: true, ordem: lista.filter(x => x.secao === b.dataset.novoAviso).length + 1 };
    const novo = !a.id;
    const m = abrirModal({
      titulo: novo ? 'Novo texto' : 'Editar texto',
      corpo: `${inSel('aSec', 'Onde aparece', SECOES.map(([v, t]) => [v, t]), a.secao)}
        ${inTxt('aTit', 'Título <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', a.titulo || '', { attrs: 'maxlength="60"' })}
        ${inTa('aTxt', 'Texto', a.texto || '', { attrs: 'maxlength="400"' })}
        <div class="grid2">${inSel('aIc', 'Ícone', ICONES_AVISO, a.icone || '')}${inNum('aOrd', 'Ordem', a.ordem ?? 0)}</div>
        ${inChk('aAtivo', 'Aparece no site', a.ativo)}`,
      rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
    });
    m.$('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmar('Excluir texto?', 'Este texto sai do site.', { botao: 'Excluir', perigo: true })) return;
      await ocupado(m.$('[data-del]'), async () => { await api.admin.avisos.remover(a.id); m.fechar(); ajTextos(box); });
    });
    m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
      exigir(m, 'aTxt', 'Escreva o texto.');
      const dados = { secao: valDe(m, 'aSec'), titulo: valDe(m, 'aTit') || null, texto: valDe(m, 'aTxt'), icone: valDe(m, 'aIc') || null, ordem: numDe(m, 'aOrd') || 0, ativo: chkDe(m, 'aAtivo') };
      if (novo) await api.admin.avisos.criar(dados); else await api.admin.avisos.atualizar(a.id, dados);
      m.fechar(); toast('Texto salvo.'); ajTextos(box);
    }));
  };
}

/* ---- Opções de bolo (pesos e massas) ---- */
async function ajBolos(box) {
  let pesos, massas, formatos = [], semFormatos = false;
  try { [pesos, massas] = await Promise.all([api.admin.pesosBolo.listar(), api.admin.massasBolo.listar()]); } catch (e) { erroToast(e); return; }
  try { formatos = await api.admin.formatosBolo.listar(); } catch (e) { semFormatos = true; }
  box.innerHTML = `<div class="cols">
    <div class="card"><div class="card-h"><div><h2>Pesos</h2><span class="dica" style="color:var(--ink-3);font-weight:400;font-size:13px">O menor peso ativo é o “a partir de” do site.</span></div></div>
      <div class="tbl">${pesos.map(p => `<div class="r ${p.ativo ? '' : 'off'}"><span class="main"><strong>${esc(formatarPeso(p.peso_kg))}</strong></span>
        <label class="sr" for="sw-peso-${p.peso_kg}">Ativo</label><input type="checkbox" class="switch" id="sw-peso-${p.peso_kg}" data-sw-peso="${p.peso_kg}" ${p.ativo ? 'checked' : ''}>
        <button type="button" class="btn icon sm ghost" data-tirar-peso="${p.peso_kg}" aria-label="Excluir ${esc(formatarPeso(p.peso_kg))}">${ic('lixo')}</button></div>`).join('')}</div>
      <form id="fPeso" style="display:flex;gap:8px;margin-top:12px;align-items:end"><div class="field" style="margin:0;flex:1"><label for="novoPeso">Novo peso (kg)</label>
        <input class="in" id="novoPeso" inputmode="decimal" placeholder="Ex.: 5,5"></div><button type="submit" class="btn primary">${ic('mais')}Adicionar</button></form>
    </div>
    <div>
    <div class="card"><div class="card-h"><h2>Massas</h2><button type="button" class="btn sm primary" data-nova-massa>${ic('mais')}Massa</button></div>
      <div class="tbl">${massas.map(x => linhaTbl({ id: x.id, attr: 'massa', cor: x.cor || '#EBC78F', titulo: x.nome, sub: x.descricao, ativo: x.ativo })).join('')}</div></div>
    <div class="card"><div class="card-h"><div><h2>Formatos</h2><span class="dica" style="color:var(--ink-3);font-weight:400;font-size:13px">O primeiro ativo já vem marcado no site.</span></div>
        ${semFormatos ? '' : `<button type="button" class="btn sm primary" data-novo-formato>${ic('mais')}Formato</button>`}</div>
      ${semFormatos ? '<div class="aviso-box" style="margin:0">Rode no Supabase o arquivo <code>20261003000200_formato_bolo.sql</code> para liberar os formatos.</div>'
        : `<div class="tbl">${formatos.length ? formatos.map(x => linhaTbl({ id: x.id, attr: 'formato', titulo: x.nome, sub: x.descricao, ativo: x.ativo })).join('') : '<div class="r"><span class="main">Nenhum formato. Sem formatos ativos, o site não pergunta.</span></div>'}</div>`}</div>
    </div>
  </div>`;
  ligarSwitch(box, { peso: api.admin.pesosBolo, massa: api.admin.massasBolo, formato: api.admin.formatosBolo });
  box.querySelector('#fPeso').addEventListener('submit', e => {
    e.preventDefault();
    ocupado(e.submitter, async () => {
      const v = lerValor(box.querySelector('#novoPeso').value);
      if (!(v > 0 && v < 100)) throw new Error('Informe um peso em kg, por exemplo 5,5.');
      if (pesos.some(p => Number(p.peso_kg) === v)) throw new Error('Esse peso já existe.');
      await api.admin.pesosBolo.criar({ peso_kg: v, ordem: Math.round(v * 10), ativo: true });
      toast(`${formatarPeso(v)} adicionado.`); cardapioAtivo = null; ajBolos(box);
    });
  });
  box.onclick = async e => {
    const tp = e.target.closest('[data-tirar-peso]');
    if (tp) {
      if (!await confirmar(`Excluir ${formatarPeso(tp.dataset.tirarPeso)}?`, 'Esse peso deixa de aparecer na escolha do bolo.', { botao: 'Excluir', perigo: true })) return;
      await ocupado(tp, async () => { await api.admin.pesosBolo.remover(Number(tp.dataset.tirarPeso)); cardapioAtivo = null; ajBolos(box); });
      return;
    }
    const bf = e.target.closest('[data-ed-formato],[data-novo-formato]');
    if (bf) {
      const x = formatos.find(y => y.id === bf.dataset.edFormato) || { ativo: true, ordem: formatos.length + 1 };
      const novo = !x.id;
      const m = abrirModal({
        titulo: novo ? 'Novo formato' : 'Editar formato',
        corpo: `${inTxt('fNome', 'Nome', x.nome || '', { attrs: 'maxlength="40" placeholder="Ex.: Retangular, Coração"' })}
          ${inTxt('fDesc', 'Descrição <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', x.descricao || '', { attrs: 'maxlength="60"' })}
          <div class="grid2">${inNum('fOrd', 'Ordem', x.ordem ?? 0)}${inTxt('fSlug', 'Código', x.slug || '', { attrs: 'maxlength="30"', dica: novo ? 'Gerado pelo nome.' : '' })}</div>
          ${inChk('fAtivo', 'Disponível', x.ativo)}`,
        rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
      });
      let manual = !novo;
      m.$('#fSlug').addEventListener('input', () => { manual = true; });
      m.$('#fNome').addEventListener('input', () => { if (!manual) m.$('#fSlug').value = slugify(m.$('#fNome').value); });
      m.$('[data-del]')?.addEventListener('click', async () => {
        if (!await confirmar(`Excluir ${x.nome}?`, 'O formato deixa de aparecer na escolha do bolo. Pedidos antigos continuam com o formato escolhido.', { botao: 'Excluir', perigo: true })) return;
        await ocupado(m.$('[data-del]'), async () => { await api.admin.formatosBolo.remover(x.id); m.fechar(); cardapioAtivo = null; ajBolos(box); });
      });
      m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
        exigir(m, 'fNome', 'Informe o nome do formato.');
        const dados = { nome: valDe(m, 'fNome'), descricao: valDe(m, 'fDesc') || null, ordem: numDe(m, 'fOrd') || 0, slug: slugify(valDe(m, 'fSlug') || valDe(m, 'fNome')), ativo: chkDe(m, 'fAtivo') };
        if (novo) await api.admin.formatosBolo.criar(dados); else await api.admin.formatosBolo.atualizar(x.id, dados);
        m.fechar(); toast('Formato salvo.'); cardapioAtivo = null; ajBolos(box);
      }));
      return;
    }
    const b = e.target.closest('[data-ed-massa],[data-nova-massa]'); if (!b) return;
    const x = massas.find(y => y.id === b.dataset.edMassa) || { ativo: true, ordem: massas.length + 1, cor: '#EBC78F' };
    const novo = !x.id;
    const m = abrirModal({
      titulo: novo ? 'Nova massa' : 'Editar massa',
      corpo: `${inTxt('mNome', 'Nome', x.nome || '', { attrs: 'maxlength="40" placeholder="Ex.: Massa de cenoura"' })}
        ${inTxt('mDesc', 'Descrição', x.descricao || '', { attrs: 'maxlength="60" placeholder="Ex.: Cenoura"' })}
        <div class="grid3">${campo('mCor', 'Cor', `<input class="in" id="mCor" type="color" value="${esc(x.cor || '#EBC78F')}" style="padding:4px;height:44px">`)}${inNum('mOrd', 'Ordem', x.ordem ?? 0)}
          ${inTxt('mSlug', 'Código', x.slug || '', { attrs: 'maxlength="30"', dica: novo ? 'Gerado pelo nome.' : '' })}</div>
        ${inChk('mAtivo', 'Disponível', x.ativo)}`,
      rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
    });
    let manual = !novo;
    m.$('#mSlug').addEventListener('input', () => { manual = true; });
    m.$('#mNome').addEventListener('input', () => { if (!manual) m.$('#mSlug').value = slugify(m.$('#mNome').value.replace(/^massa\s+/i, '')); });
    m.$('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmar(`Excluir ${x.nome}?`, 'A massa deixa de aparecer na escolha do bolo.', { botao: 'Excluir', perigo: true })) return;
      await ocupado(m.$('[data-del]'), async () => { await api.admin.massasBolo.remover(x.id); m.fechar(); cardapioAtivo = null; ajBolos(box); });
    });
    m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
      exigir(m, 'mNome', 'Informe o nome da massa.');
      const dados = { nome: valDe(m, 'mNome'), descricao: valDe(m, 'mDesc') || null, cor: valDe(m, 'mCor'), ordem: numDe(m, 'mOrd') || 0,
        slug: slugify(valDe(m, 'mSlug') || valDe(m, 'mNome').replace(/^massa\s+/i, '')), ativo: chkDe(m, 'mAtivo') };
      if (novo) await api.admin.massasBolo.criar(dados); else await api.admin.massasBolo.atualizar(x.id, dados);
      m.fechar(); toast('Massa salva.'); cardapioAtivo = null; ajBolos(box);
    }));
  };
}

/* ---- Status dos pedidos ---- */
async function ajStatus(box) {
  try { STATUS = await api.admin.status.listar(); } catch (e) { erroToast(e); return; }
  box.innerHTML = `<div class="page-head" style="margin-bottom:10px"><p class="dica" style="margin:0;color:var(--ink-2);font-weight:400">A ordem define o botão “Avançar” no pedido. Status “encerrados” saem da lista de pedidos em aberto.</p>
      <button type="button" class="btn primary sm" data-novo-status>${ic('mais')}Status</button></div>
    <div class="tbl">${STATUS.map(s => linhaTbl({ id: s.codigo, attr: 'status', cor: s.cor, titulo: s.nome, sub: `${s.descricao || ''}${s.finalizado ? ' · encerra o pedido' : ''}`, ativo: s.ativo })).join('')}</div>`;
  ligarSwitch(box, { status: api.admin.status });
  box.onclick = e => {
    const b = e.target.closest('[data-ed-status],[data-novo-status]'); if (!b) return;
    const s = STATUS.find(x => x.codigo === b.dataset.edStatus) || { ativo: true, finalizado: false, ordem: STATUS.length + 1, cor: '#6E4B3A' };
    const novo = !s.codigo;
    const m = abrirModal({
      titulo: novo ? 'Novo status' : 'Editar status',
      corpo: `${inTxt('sNome', 'Nome', s.nome || '', { attrs: 'maxlength="40" placeholder="Ex.: Saiu para entrega"' })}
        ${inTxt('sDesc', 'Descrição', s.descricao || '', { attrs: 'maxlength="120"' })}
        <div class="grid3">${campo('sCor', 'Cor', `<input class="in" id="sCor" type="color" value="${esc(s.cor || '#6E4B3A')}" style="padding:4px;height:44px">`)}${inNum('sOrd', 'Ordem', s.ordem ?? 0)}
          ${inTxt('sCod', 'Código', s.codigo || '', { attrs: novo ? 'maxlength="30"' : 'readonly', dica: novo ? 'Gerado pelo nome.' : 'Não muda.' })}</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap">${inChk('sFim', 'Encerra o pedido', s.finalizado)}${inChk('sAtivo', 'Em uso', s.ativo)}</div>`,
      rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
    });
    if (novo) m.$('#sNome').addEventListener('input', () => { m.$('#sCod').value = slugify(m.$('#sNome').value).replace(/-/g, '_'); });
    m.$('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmar(`Excluir “${s.nome}”?`, 'Só dá para excluir um status que nenhum pedido usa. Se já foi usado, desligue “Em uso”.', { botao: 'Excluir', perigo: true })) return;
      await ocupado(m.$('[data-del]'), async () => { await api.admin.status.remover(s.codigo); m.fechar(); ajStatus(box); });
    });
    m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
      exigir(m, 'sNome', 'Informe o nome.');
      const dados = { nome: valDe(m, 'sNome'), descricao: valDe(m, 'sDesc') || null, cor: valDe(m, 'sCor'), ordem: numDe(m, 'sOrd') || 0, finalizado: chkDe(m, 'sFim'), ativo: chkDe(m, 'sAtivo') };
      if (novo) {
        const codigo = valDe(m, 'sCod') || slugify(dados.nome).replace(/-/g, '_');
        if (!/^[a-z_]+$/.test(codigo)) throw new Error('O código pode ter só letras minúsculas e “_”.');
        await api.admin.status.criar({ codigo, ...dados });
      } else await api.admin.status.atualizar(s.codigo, dados);
      m.fechar(); toast('Status salvo.'); ajStatus(box);
    }));
  };
}

/* ---- Equipe ---- */
async function ajEquipe(box) {
  let lista;
  try { lista = await api.admin.equipe.listar(); }
  catch (e) { box.innerHTML = `<div class="aviso-box">${esc(e.message)}${/não existe no banco/.test(e.message) ? ' (arquivo <code>20261003000100_equipe.sql</code>)' : ''}</div>`; return; }
  box.innerHTML = `<div class="aviso-box"><b>Para dar acesso a alguém:</b> 1) no Supabase, crie o usuário em Authentication → Users → Add user (com e-mail e senha);
      2) aqui, toque em “Liberar acesso” e use o mesmo e-mail. <b>Atendimento</b> vê só pedidos; <b>Administração</b> vê tudo.</div>
    <div class="page-head" style="margin-bottom:10px"><span></span><button type="button" class="btn primary sm" data-novo-membro>${ic('mais')}Liberar acesso</button></div>
    <div class="tbl">${lista.map(a => linhaTbl({ id: a.user_id, attr: 'membro', titulo: `${a.nome}${a.user_id === perfil.user_id ? ' (você)' : ''}`,
      sub: `${a.email || 'sem e-mail'} · ${a.papel === 'admin' ? 'Administração' : 'Atendimento'}${a.ativo ? '' : ' · bloqueado'}${a.ultimo_acesso ? ' · último acesso ' + dataHora(a.ultimo_acesso) : ''}` })).join('')}</div>`;
  box.onclick = e => {
    const b = e.target.closest('[data-ed-membro],[data-novo-membro]'); if (!b) return;
    const a = lista.find(x => x.user_id === b.dataset.edMembro) || { papel: 'atendente', ativo: true };
    const novo = !a.user_id, eu = a.user_id === perfil.user_id;
    const m = abrirModal({
      titulo: novo ? 'Liberar acesso' : 'Editar acesso',
      corpo: `${inTxt('eEmail', 'E-mail', a.email || '', { attrs: `type="email" ${novo ? '' : 'readonly'}`, dica: novo ? 'O mesmo e-mail do usuário criado no Supabase.' : '' })}
        ${inTxt('eNome', 'Nome', a.nome || '', { attrs: 'maxlength="60"' })}
        ${inSel('ePapel', 'Acesso', [['atendente', 'Atendimento (só pedidos)'], ['admin', 'Administração (tudo)']], a.papel, { attrs: eu ? 'disabled' : '' })}
        ${eu ? '' : inChk('eAtivo', 'Acesso liberado', a.ativo)}`,
      rodape: `${novo || eu ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Tirar acesso</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
    });
    m.$('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmar(`Tirar o acesso de ${a.nome}?`, 'A pessoa não consegue mais entrar no backoffice. O usuário continua existindo no Supabase.', { botao: 'Tirar acesso', perigo: true })) return;
      await ocupado(m.$('[data-del]'), async () => { await api.admin.equipe.remover(a.user_id); m.fechar(); ajEquipe(box); });
    });
    m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
      exigir(m, 'eEmail', 'Informe o e-mail.'); exigir(m, 'eNome', 'Informe o nome.');
      await api.admin.equipe.salvar({ email: valDe(m, 'eEmail'), nome: valDe(m, 'eNome'), papel: eu ? 'admin' : valDe(m, 'ePapel'), ativo: eu ? true : chkDe(m, 'eAtivo') });
      m.fechar(); toast('Acesso salvo.'); ajEquipe(box);
    }));
  };
}

iniciar();
