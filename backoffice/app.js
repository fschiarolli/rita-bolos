/**
 * Backoffice Rita Bolos
 * ------------------------------------------------------------------
 * Pedidos (status, observações, pagamentos, recibo), cardápio e ajustes.
 * Usa a mesma API do site (../js/rita-api.js).
 * Modo demonstração, sem banco: abra com ?demo
 */
import { criarApi, conectar, formatarPreco as R, formatarPeso, formatarData, linkRecibo, linkWhatsApp, abrirWhatsApp, linkCompartilhavel, montarMensagemStatus, prepararAba,
  separarReferencia, juntarReferencia, ehTopper, pixDe, textoPix, mapaKits, achatarCardapio, conteudoKit } from '../js/rita-api.js';
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
/** Quem produz topos e personalizados: entra no backoffice, mas só vê o módulo de topos (sql/topos.sql). */
const ehProdutor = () => perfil?.papel === 'personalizados';
const podeTopos = () => isAdmin() || ehProdutor();
const telaInicial = () => (ehProdutor() ? 'topos' : 'painel');
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
// maxlength com folga: colar "+55 19 99999-9999" (como o WhatsApp mostra) não pode cortar o último dígito
const ATTR_TEL = 'type="tel" inputmode="tel" data-tel maxlength="20" placeholder="(19) 99999-9999" autocomplete="off"';
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
const TIPOS_PIX = ['CPF', 'CNPJ', 'Celular', 'E-mail', 'Chave aleatória'];
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
    ${DEMO ? '<div class="demo-note">Modo demonstração: entre com qualquer e-mail e senha. Tudo fica salvo só neste navegador. Para ver como quem produz os topos enxerga, entre com <b>topos@demo.com.br</b>.</div>' : ''}
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
  if (!ehProdutor()) { try { STATUS = await api.admin.status.listar(); } catch (e) { STATUS = []; } }
  telaShell();
  if (!ehProdutor()) ligarTempoReal();
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#' + telaInicial());
  rotear(true);
  if (!ehProdutor()) atualizarBadge();
  // topos e avisos: só ligam o tempo real se já existirem no banco (sql/topos.sql)
  if (podeTopos()) atualizarBadgeTopos().then(ok => { if (ok && perfil) ligarTempoRealTopos(); });
  if (!ehProdutor()) carregarAvisos().then(ok => { if (ok && perfil) ligarAvisos(); });
  if (!ehProdutor()) mapaKitsLoja();   // conteúdo dos kits já pronto para a gaveta e a impressão
  if (isAdmin()) badgeEstoque();
  if (!ehProdutor() && confNiimbot().usar) { carregarNiimblue().catch(() => {}); reconectarNiimbot(); }
  if (!ehProdutor() && impressaoAuto().ligada) toast('Impressão automática ligada neste aparelho: pedidos confirmados saem na impressora.', { tempo: 6000 });
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
  { id: 'topos', rot: 'Topos', ic: 'topo', topos: true },
  { id: 'relatorio', rot: 'Relatório', ic: 'grafico', admin: true },
  { id: 'prejuizos', rot: 'Prejuízos', ic: 'alerta', admin: true },
  { id: 'estoque', rot: 'Estoque', ic: 'estoque', admin: true },
  { id: 'cardapio', rot: 'Cardápio', ic: 'bolo', admin: true },
  { id: 'ajustes', rot: 'Ajustes', ic: 'config', admin: true }
];
/** Quem vê cada item do menu: Topos para a Administração e quem produz personalizados (que só vê Topos). */
const podeVerNav = n => (ehProdutor() ? !!n.topos : n.topos ? isAdmin() : (!n.admin || isAdmin()));
const iniciais = nome => String(nome || '?').trim().split(/\s+/).filter(p => /^\p{L}/u.test(p)).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

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
const papelTxt = () => ({ admin: 'Administração', personalizados: 'Topos e personalizados' })[perfil.papel] || 'Atendimento';
function telaShell() {
  const itens = NAV.filter(podeVerNav), prod = ehProdutor();
  const link = (n, cls) => `<a class="${cls}" href="#${n.id}" data-nav="${n.id}">${ic(n.ic)}<span>${n.rot}</span>${n.badge ? '<span class="nav-badge" data-badge hidden></span>' : ''}${n.topos ? '<span class="nav-badge" data-badge-topos hidden></span>' : ''}${n.id === 'estoque' ? '<span class="nav-badge" data-badge-estoque hidden></span>' : ''}</a>`;
  const principais = itens.filter(n => !n.admin), gestao = itens.filter(n => n.admin);
  app.innerHTML = `<div class="shell">
    <aside class="side" aria-label="Menu principal">
      <a class="brand" href="#${telaInicial()}"><img src="${esc(LOGO)}" alt=""><div><strong>Rita Bolos</strong><span>Backoffice${DEMO ? ' · demo' : ''}</span></div></a>
      <nav class="side-nav">
        <p class="side-sec">Principal</p>${principais.map(n => link(n, 'nav-a')).join('')}
        ${gestao.length ? `<p class="side-sec">Gestão</p>${gestao.map(n => link(n, 'nav-a')).join('')}` : ''}
        ${prod ? '' : `<p class="side-sec">Atalhos</p>
        <a class="nav-a" href="${esc(urlQuadro())}" target="_blank" rel="noopener">${ic('tv')}<span>Quadro da equipe</span>${ic('externo', 'ic ext')}</a>
        <a class="nav-a" href="${esc(urlSite())}" target="_blank" rel="noopener">${ic('externo')}<span>Ver o site</span>${ic('externo', 'ic ext')}</a>
        <a class="nav-a" href="${esc(urlPote())}" target="_blank" rel="noopener">${ic('pote')}<span>Página do bolo no pote</span>${ic('externo', 'ic ext')}</a>`}
      </nav>
      <div class="side-foot">
        <button type="button" class="user-card" data-act="conta" aria-label="Minha conta">${avatarHTML(perfil, 'aria-hidden="true" data-eu')}
          <span class="uc-t"><strong>${esc(perfil.nome)}</strong><small>${papelTxt()}${perfil.email ? ' · ' + esc(perfil.email) : ''}</small></span></button>
        <button type="button" class="btn icon sm ghost" data-act="sair" aria-label="Sair da conta" title="Sair">${ic('sair')}</button>
      </div>
    </aside>
    <div class="coluna">
      <header class="topo">
        <a class="topo-marca" href="#${telaInicial()}"><img src="${esc(LOGO)}" alt="">Rita Bolos${DEMO ? '<small>demo</small>' : ''}</a>
        ${prod ? '' : `<form class="topo-busca" id="topoBusca" role="search">${ic('busca')}<label class="sr" for="topoBuscaIn">Buscar pedido</label>
          <input id="topoBuscaIn" type="search" placeholder="Buscar pedido: nome, telefone ou código" autocomplete="off"><kbd aria-hidden="true">/</kbd></form>`}
        <div class="topo-acts">
          ${prod ? '' : `<button type="button" class="topo-bt nb-ind" data-act="niimbot" hidden>${ic('imprimir')}<span class="nb-ponto" aria-hidden="true"></span></button>`}
          ${prod ? '' : `<button type="button" class="topo-bt" data-act="avisos" aria-haspopup="dialog" aria-expanded="false" aria-label="Avisos" title="Avisos" hidden>${ic('sino')}<span class="topo-badge" data-badge-avisos hidden></span></button>`}
          <button type="button" class="topo-bt" data-act="tema" aria-haspopup="menu" aria-expanded="false">${ic(temaDe(temaAtual()).icone)}</button>
          ${prod ? '' : `<a class="topo-bt" data-tv href="${esc(urlQuadro())}" target="_blank" rel="noopener" aria-label="Abrir o quadro da equipe (TV)" title="Quadro da equipe (TV)">${ic('tv')}</a>`}
          <button type="button" class="topo-av" data-act="conta" aria-label="Minha conta" title="${esc(perfil.nome)}">${avatarHTML(perfil, 'data-eu')}</button>
        </div>
      </header>
      <main class="conteudo" id="conteudo" tabindex="-1"></main>
      <footer class="rodape"><span>© ${new Date().getFullYear()} Rita Bolos · Backoffice${DEMO ? ' (demonstração)' : ''}</span>
        ${prod ? '' : `<span><a href="${esc(urlSite())}" target="_blank" rel="noopener">Site</a><a href="${esc(urlQuadro())}" target="_blank" rel="noopener">Quadro da equipe</a></span>`}</footer>
    </div>
    ${itens.length > 1 ? `<nav class="nav-mob" aria-label="Menu principal">${itens.map(n => link(n, '')).join('')}</nav>` : ''}
  </div>
  <div class="veu" id="veu"></div>
  <aside class="gaveta" id="gaveta" role="dialog" aria-modal="true" aria-labelledby="gavTitulo" inert></aside>`;
  $('#veu').addEventListener('click', () => fecharGaveta());
  atualizarBotaoTema();
  $('#topoBusca')?.addEventListener('submit', e => {
    e.preventDefault();
    const termo = $('#topoBuscaIn').value.trim(); if (!termo) return;
    Object.assign(filtro, { ...FILTRO_PADRAO, busca: termo, status: 'todos', periodo: 'todas' });
    $('#topoBuscaIn').value = ''; $('#topoBuscaIn').blur();
    if (telaAtual === 'pedidos' && rotaAtual === 'pedidos') telaPedidos($('#conteudo')); else location.hash = '#pedidos';
  });
}

/* ---- Temas: Automático (segue o aparelho), Claro e Escuro ----
   As cores ficam no index.html (:root e :root[data-theme="dark"]); a escolha fica salva neste aparelho.
   Quem tinha escolhido um tema que saiu volta para o Automático. */
const TEMAS = [
  { id: 'auto', nome: 'Automático', desc: 'Claro ou escuro, como o aparelho', attr: null },
  { id: 'claro', nome: 'Claro', desc: 'Creme e chocolate', attr: 'light', meta: '#F8F2EA', icone: 'sol', amostra: ['#F8F2EA', '#FFFFFF', '#4A2A1C', '#2B7465'] },
  { id: 'escuro', nome: 'Escuro', desc: 'Para pouca luz', attr: 'dark', meta: '#120B08', icone: 'lua', amostra: ['#120B08', '#1C130F', '#F2DCC6', '#8FD3BF'] }
];
const temaDe = id => TEMAS.find(t => t.id === id) || TEMAS[0];
const temaEscolhido = () => { try { const t = localStorage.getItem('ritabolos.tema'); return TEMAS.some(x => x.id === t) ? t : 'auto'; } catch (e) { return 'auto'; } };
/** Tema em uso agora: o automático vira claro ou escuro conforme o aparelho. */
const temaAtual = () => { const t = temaEscolhido(); return t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro') : t; };
const amostraTema = t => t.id === 'auto' ? '<span class="tema-amostra auto" aria-hidden="true"></span>'
  : `<span class="tema-amostra ${t.id}" aria-hidden="true" style="--a:${t.amostra[0]};--b:${t.amostra[1]};--c:${t.amostra[2]};--d:${t.amostra[3]}"></span>`;
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
        ${ehProdutor() ? '' : `<div class="imp-auto"><p class="secao-t" style="margin:4px 0 8px">Impressora deste aparelho</p>
          ${inChk('impAuto', 'Imprimir sozinho cada pedido confirmado', impressaoAuto().ligada)}
          <div class="imp-linha"><label class="sr" for="impFormato">O que imprimir</label>
            <select class="sel" id="impFormato"><option value="etiqueta" ${impressaoAuto().formato !== 'pedido' ? 'selected' : ''}>Etiqueta para a caixa</option><option value="pedido" ${impressaoAuto().formato === 'pedido' ? 'selected' : ''}>Pedido completo</option></select>
            <button type="button" class="btn ghost sm" data-imp-teste>${ic('imprimir')}Testar</button></div>
          <p class="dica">Ligue só no computador da térmica, com o backoffice aberto. Para sair direto, sem a janela de impressão, abra o Chrome com <code>--kiosk-printing</code> e deixe a térmica como impressora padrão.</p></div>
        <div class="imp-auto"><p class="secao-t" style="margin:4px 0 8px">Etiquetas na Niimbot (Bluetooth)</p>
          ${inChk('nbUsar', 'Imprimir as etiquetas na Niimbot', confNiimbot().usar)}
          <div class="nb-corpo" id="nbCorpo" ${confNiimbot().usar ? '' : 'hidden'}>
            <label class="sr" for="nbCont">O que sai em cada etiqueta</label>
            <select class="sel" id="nbCont" style="margin-bottom:8px">${CONTEUDOS_ETIQUETA.map(([v, t]) => `<option value="${v}" ${v === (confNiimbot().conteudo || 'producao') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
            <div class="imp-linha"><label class="sr" for="nbTam">Tamanho da etiqueta</label>
              <select class="sel" id="nbTam">${TAMANHOS_ETIQUETA.map(([v, t]) => `<option value="${v}" ${v === confNiimbot().tamanho ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
              <button type="button" class="btn ghost sm" data-nb-conectar>${niimbotConectada() ? 'Reconectar' : 'Conectar'}</button>
              <button type="button" class="btn ghost sm" data-nb-teste>${ic('imprimir')}Testar</button></div>
            <p class="nb-status">${ic('imprimir')}<span id="nbStatus">${niimbotConectada() ? `Conectada: ${esc(niim.nome)}` : 'Desconectada'}</span></p>
            <div class="nb-previa" id="nbPrevia" aria-label="Prévia da etiqueta"></div>
            <p class="dica">Vale para o botão Etiqueta do pedido e para a impressão automática (com "Etiqueta para a caixa"). Ligue a Niimbot, toque em Conectar e escolha a impressora na lista. Funciona no Chrome do computador e do Android (no iPhone, não).</p>
          </div></div>
        <a class="btn ghost block" href="${esc(urlSite())}" target="_blank" rel="noopener">${ic('externo')}Abrir o site</a>
        <div style="display:flex;gap:8px"><a class="btn ghost" style="flex:1" href="${esc(urlPote())}" target="_blank" rel="noopener">${ic('pote')}Página do bolo no pote</a>
          <button type="button" class="btn ghost" data-copiar-pote aria-label="Copiar o link da página do bolo no pote" title="Copiar link">${ic('copiar')}</button></div>
        <a class="btn ghost block" href="${esc(urlQuadro())}" target="_blank" rel="noopener">${ic('tv')}Quadro da equipe (TV)</a>`}
        ${DEMO ? `<button type="button" class="btn ghost block" data-reiniciar>${ic('atualizar')}Recomeçar a demonstração</button>` : `<button type="button" class="btn ghost block" data-senha>Trocar senha</button>`}
        <button type="button" class="btn danger block" data-sair>${ic('sair')}Sair</button>
      </div>`
  });
  m.$('[data-trocar-avatar]').addEventListener('click', () => { m.fechar(); modalAvatar(); });
  const salvarImp = () => {
    salvarImpressaoAuto({ ligada: chkDe(m, 'impAuto'), formato: valDe(m, 'impFormato') || 'etiqueta' });
    if (chkDe(m, 'impAuto')) toast('Impressão automática ligada neste aparelho: cada pedido confirmado sai na impressora.');
  };
  m.$('#impAuto')?.addEventListener('change', salvarImp);
  m.$('#impFormato')?.addEventListener('change', () => salvarImpressaoAuto({ ...impressaoAuto(), formato: valDe(m, 'impFormato') }));
  // pedido para o teste e a prévia: o mais recente, de preferência com bolo
  const pedidoDeTeste = async () => {
    const { pedidos } = await api.admin.pedidos.listar({ porPagina: 15, ordenarPor: 'criado_em', crescente: false });
    if (!pedidos.length) throw new Error('Ainda não há pedidos para usar no teste.');
    const comItens = await pedidosComItens(pedidos);
    return comItens.find(p => p.itens.some(ehBoloProducao)) || comItens[0];
  };
  m.$('[data-imp-teste]')?.addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    const p = await pedidoDeTeste();
    await (valDe(m, 'impFormato') === 'pedido' ? imprimirTermica(p) : imprimirEtiquetaDoPedido(p));
  }));
  // Niimbot: liga/desliga, tamanho, conectar, testar e a prévia da etiqueta
  let pedidoPrevia = null;
  const previa = async () => {
    const box = m.$('#nbPrevia'); if (!box || box.closest('[hidden]')) return;
    try { pedidoPrevia = pedidoPrevia || await pedidoDeTeste(); await mapaKitsLoja(); } catch (e) { box.textContent = 'A prévia aparece quando houver um pedido.'; return; }
    const { W, H, pxmm } = medidasEtiqueta(niimbotConectada() ? niim.client.getModelMetadata() : null);
    const c = canvasEtiqueta(etiquetasDoPedido(pedidoPrevia)[0], W, H, pxmm, await configLoja() || {});
    const [wMm] = confNiimbot().tamanho.split('x').map(Number);
    c.style.width = `${Math.min(280, wMm * 5.2)}px`; c.setAttribute('role', 'img'); c.setAttribute('aria-label', `Prévia da etiqueta do pedido ${pedidoPrevia.codigo}`);
    box.replaceChildren(c);
  };
  m.$('#nbUsar')?.addEventListener('change', e => {
    salvarConfNiimbot({ usar: e.target.checked });
    m.$('#nbCorpo').hidden = !e.target.checked;
    atualizarIndicadorNiimbot();
    if (e.target.checked) { carregarNiimblue().catch(() => {}); previa(); }   // já deixa o módulo pronto para conectar
  });
  m.$('#nbTam')?.addEventListener('change', e => { salvarConfNiimbot({ tamanho: e.target.value }); previa(); });
  m.$('#nbCont')?.addEventListener('change', e => { salvarConfNiimbot({ conteudo: e.target.value }); previa(); });
  m.$('[data-nb-conectar]')?.addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    await conectarNiimbot(); toast(`Niimbot conectada (${niim.nome}).`); previa();
  }));
  m.$('[data-nb-teste]')?.addEventListener('click', ev => ocupado(ev.currentTarget, async () => { await etiquetaNiimbot(pedidoPrevia || await pedidoDeTeste()); }));
  if (confNiimbot().usar) { carregarNiimblue().catch(() => {}); previa(); }
  m.$('[data-copiar-pote]')?.addEventListener('click', async () => {
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
  const [rota, pedidoId] = decodeURIComponent(location.hash.slice(1) || telaInicial()).split('@');
  let [tela, sub] = rota.split('/');
  if (!NAV.some(n => n.id === tela && podeVerNav(n))) tela = telaInicial();
  if (forcar || rota !== rotaAtual) {
    rotaAtual = rota; telaAtual = tela;
    $$('[data-nav]').forEach(a => { if (a.dataset.nav === tela) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const el = $('#conteudo');
    document.title = `${NAV.find(n => n.id === tela)?.rot || 'Painel'} — Backoffice Rita Bolos`;
    if (tela !== 'topos') sairTvTopos();
    ({ painel: telaPainel, hoje: telaHoje, pedidos: telaPedidos, topos: telaTopos, relatorio: telaRelatorio, prejuizos: telaPrejuizos, estoque: telaEstoque, cardapio: telaCardapio, ajustes: telaAjustes })[tela](el, sub);
    window.scrollTo(0, 0);
  }
  if (pedidoId && !ehProdutor()) abrirGaveta(pedidoId); else fecharGaveta(true);
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
  if (telaAtual === 'pedidos') { carregarPedidos(false, true); contarDias(); }
  if (telaAtual === 'hoje') recarregarHoje();
  if (telaAtual === 'topos') carregarTopos(true);
  if (telaAtual === 'estoque') carregarEstoque();   // um pedido confirmado pode ter dado baixa
}

/* Cabeçalho padrão das telas */
function cabecalho(titulo, acoes = '', subtitulo = '') {
  const secao = NAV.find(n => n.id === telaAtual)?.rot || titulo;
  return `<div class="page-head"><div class="ph-txt">
      <nav class="trilha" aria-label="Você está em"><a href="#${telaInicial()}" aria-label="Início">${ic('casa')}</a>${ic('seta', 'ic sep')}<span>${esc(secao)}</span></nav>
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
    case 'avisos': abrirAvisos(a); break;
    case 'niimbot':
      if (niimbotConectada()) toast(`Niimbot conectada (${niim.nome}).`, { acao: { rotulo: 'Desconectar', fn: () => niim?.client?.disconnect().then(atualizarIndicadorNiimbot) } });
      else ocupado(a, async () => { await conectarNiimbot(); toast(`Niimbot conectada (${niim.nome}).`); });
      break;
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
    if (tipo !== 'DELETE' && pedido?.status === 'confirmado') imprimirSeConfirmado(pedido).catch(erroToast);
    if (tipo === 'INSERT' && pedido?.origem === 'site') {
      tocarAviso();
      toast(`Novo pedido ${pedido.codigo || ''} de ${pedido.cliente_nome || 'cliente'}`, { tipo: 'novo', acao: { rotulo: 'Ver', fn: () => verPedido(pedido.id) }, tempo: 12000 });
    }
    atualizarBadge();
    clearTimeout(recarga);
    recarga = setTimeout(() => {
      if (isAdmin()) badgeEstoque();   // confirmar ou cancelar pedido mexe no estoque
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
    if (evento === 'SIGNED_OUT') { perfil = null; pararTempoReal?.(); pararTempoReal = null; pararToposTempoReal?.(); pararToposTempoReal = null; pararAvisos?.(); pararAvisos = null; fecharAvisos(); sairTvTopos(); fecharGaveta(true); telaLogin(); }
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

/* Imprimir vários pedidos (cupom de 80 mm ou etiquetas): os da lista filtrada (Pedidos) ou os de hoje (Hoje) */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lote-pedidos],[data-lote-hoje]'); if (!b || !perfil || ehProdutor()) return;
  if (b.dataset.lotePedidos !== undefined) ocupado(b, async () => {
    const r = await api.admin.pedidos.listar({ ...consultaPedidos(), porPagina: 500, pagina: 1 });
    await modalImprimirLote(r.pedidos, `Imprimir ${r.total} ${r.total === 1 ? 'pedido' : 'pedidos'} ${descricaoFiltro()}`);
  });
  else ocupado(b, () => modalImprimirLote(hojeLista, `Imprimir o dia · ${dataLonga()}`));
});
/* "Limpar filtros" da lista de pedidos */
document.addEventListener('click', e => {
  if (!e.target.closest('[data-limpar-filtros]') || telaAtual !== 'pedidos') return;
  Object.assign(filtro, FILTRO_PADRAO);
  telaPedidos($('#conteudo'));
});
/* Atalhos do painel para a lista já filtrada */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-filtro]'); if (!a) return;
  const f = a.dataset.filtro;
  Object.assign(filtro, FILTRO_PADRAO);
  if (f === 'hoje') { filtro.periodo = 'dia'; filtro.dia = hojeISO(); }
  if (f === 'amanha') { filtro.periodo = 'dia'; filtro.dia = hojeISO(1); }
  if (f === 'novos') { filtro.periodo = 'todas'; filtro.status = 'todos'; filtro.extra = 'novos'; }
  if (f === 'sinal') { filtro.periodo = 'todas'; filtro.pagamento = 'sinal_pendente'; }
  if (f === 'saldo') { filtro.periodo = 'todas'; filtro.pagamento = 'com_saldo'; }
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
  el.innerHTML = cabecalho('Hoje', `<button type="button" class="btn ghost" data-lote-hoje title="Imprimir os pedidos de hoje: cupom de 80 mm ou etiquetas">${ic('imprimir')}Imprimir</button><button type="button" class="btn ghost" data-act="novo-pedido">${ic('mais')}Novo pedido</button>`,
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
  $('#hjResumo').innerHTML = `<span><b>${pendentes.length}</b> para retirar</span>
    <span><b>${feitos.length}</b> já ${esc((ret?.nome || 'retirado').toLowerCase())}${feitos.length === 1 ? '' : 's'}</span>`;
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
/* periodo: proximas | semana | dia (filtro.dia) | entre (filtro.de, filtro.ate) | atrasadas | todas
   diaSemana: '' ou 0 (domingo) a 6 (sábado); pagamento: '' | sinal_pendente | sinal_pago | com_saldo | pago */
const FILTRO_PADRAO = { busca: '', status: 'abertos', periodo: 'proximas', dia: '', de: '', ate: '', diaSemana: '', origem: '', pagamento: '', ordem: '', extra: null };
const filtro = { ...FILTRO_PADRAO };
const PERIODOS = [['proximas', 'Hoje em diante'], ['semana', 'Próximos 7 dias'], ['dia', 'Um dia…'], ['entre', 'Entre datas…'], ['atrasadas', 'Retirada já passou'], ['todas', 'Todas as datas']];
const FILTRO_DIAS_SEMANA = [['', 'Qualquer dia'], ['0', 'Domingos'], ['1', 'Segundas'], ['2', 'Terças'], ['3', 'Quartas'], ['4', 'Quintas'], ['5', 'Sextas'], ['6', 'Sábados']];
const PAGAMENTOS_FILTRO = [['', 'Qualquer situação'], ['sinal_pendente', 'Sinal pendente'], ['sinal_pago', 'Sinal pago, falta o resto'], ['com_saldo', 'Com saldo a receber'], ['pago', 'Tudo pago']];
const ORDENS = [['', 'Automática'], ['retirada', 'Retirada mais cedo primeiro'], ['retirada_desc', 'Retirada mais tarde primeiro'], ['criado', 'Feitos por último primeiro']];
const EXTRAS = { novos: 'Feitos hoje' };
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
let listaPedidos = [], totalPedidos = 0, paginaPedidos = 1;
const somarDiasIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaDaSemanaIso = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
/** "hoje", "amanhã", "domingo, 11/10" */
function nomeDia(iso) {
  if (iso === hojeISO()) return 'hoje';
  if (iso === hojeISO(1)) return 'amanhã';
  if (iso === hojeISO(-1)) return 'ontem';
  return `${NOMES_DIA[diaDaSemanaIso(iso)]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
/** Filtros que não são de data (valem também para a contagem de pedidos por dia). */
function filtrosComuns() {
  const f = {};
  if (filtro.status === 'abertos') f.apenasAbertos = true; else if (filtro.status !== 'todos') f.status = filtro.status;
  if (filtro.origem) f.origem = filtro.origem;
  if (filtro.pagamento === 'sinal_pendente') f.sinalPago = false;
  if (filtro.pagamento === 'sinal_pago') { f.sinalPago = true; f.comSaldo = true; }
  if (filtro.pagamento === 'com_saldo') f.comSaldo = true;
  if (filtro.pagamento === 'pago') f.quitado = true;
  if (filtro.extra === 'novos') f.criadoDesde = `${hojeISO()}T00:00:00-03:00`;
  return f;
}
/** Quantos filtros de "Mais filtros" estão ligados. */
const filtrosExtrasAtivos = () => [filtro.diaSemana !== '' && filtro.periodo !== 'dia', filtro.origem, filtro.pagamento, filtro.ordem].filter(Boolean).length;
const filtroMudou = () => !!(filtro.busca.trim() || filtro.status !== FILTRO_PADRAO.status || filtro.periodo !== FILTRO_PADRAO.periodo || filtrosExtrasAtivos() || filtro.extra);

function telaPedidos(el) {
  const chips = [['abertos', 'Em aberto'], ...STATUS.filter(s => s.ativo).sort((a, b) => a.ordem - b.ordem).map(s => [s.codigo, s.nome, s.cor]), ['todos', 'Todos']];
  const sel = (id, rot, ops, val) => campo(id, rot, `<select class="sel" id="${id}">${ops.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`);
  const extras = filtrosExtrasAtivos();
  el.innerHTML = cabecalho('Pedidos', `<button type="button" class="btn ghost" data-lote-pedidos title="Imprimir os pedidos desta lista: cupom de 80 mm ou etiquetas">${ic('imprimir')}Imprimir</button><button type="button" class="btn primary" data-act="novo-pedido">${ic('mais')}Novo pedido</button>`,
      'Pedidos do site, do WhatsApp e do balcão. Toque em um pedido para ver tudo.') + `
    <div class="filtros">
      <div class="linha">
        <div class="busca">${ic('busca')}<label class="sr" for="fBusca">Buscar pedido</label>
          <input class="in" id="fBusca" type="search" placeholder="Nome, telefone, código ou item (ex.: kit)" value="${esc(filtro.busca)}" autocomplete="off"></div>
        <label class="sr" for="fPeriodo">Data de retirada</label>
        <select class="sel" id="fPeriodo" style="width:auto;flex:0 1 200px">${PERIODOS.map(([v, t]) => `<option value="${v}" ${v === filtro.periodo ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <button type="button" class="btn ghost" id="fMaisBt" aria-expanded="${extras ? 'true' : 'false'}" aria-controls="fMais">${ic('config')}Mais filtros<span class="f-cont" id="fCont" ${extras ? '' : 'hidden'}>${extras}</span></button>
      </div>
      <div class="linha f-datas" id="fDatas"></div>
      <div class="dias-ret" id="fDias" role="group" aria-label="Retirada nos próximos dias"></div>
      <div class="f-mais" id="fMais" ${extras ? '' : 'hidden'}>
        ${sel('fSemana', 'Dia da semana', FILTRO_DIAS_SEMANA, filtro.diaSemana)}${sel('fOrigem', 'Origem', [['', 'Qualquer origem'], ...Object.entries(ORIGENS)], filtro.origem)}
        ${sel('fPagto', 'Pagamento', PAGAMENTOS_FILTRO, filtro.pagamento)}${sel('fOrdem', 'Ordem', ORDENS, filtro.ordem)}
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
  $('#fPeriodo').addEventListener('change', e => {
    filtro.periodo = e.target.value;
    if (filtro.periodo === 'dia' && !filtro.dia) filtro.dia = hojeISO();
    if (filtro.periodo === 'entre' && !filtro.de && !filtro.ate) { filtro.de = hojeISO(); filtro.ate = hojeISO(6); }
    atualizarFiltrosData(); carregarPedidos();
    if (filtro.periodo === 'dia' || filtro.periodo === 'entre') $('#fDatas input')?.focus();
  });
  $('#fMaisBt').addEventListener('click', e => { const p = $('#fMais'); p.hidden = !p.hidden; e.currentTarget.setAttribute('aria-expanded', String(!p.hidden)); });
  [['fSemana', 'diaSemana'], ['fOrigem', 'origem'], ['fPagto', 'pagamento'], ['fOrdem', 'ordem']].forEach(([id, k]) => $('#' + id).addEventListener('change', e => {
    filtro[k] = e.target.value; atualizarFiltrosData(); carregarPedidos(); if (k !== 'ordem') contarDias();
  }));
  // dia escolhido, entre datas, e os botões dos próximos dias
  $('#fDatas').addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'fDia' && e.target.value) filtro.dia = e.target.value;
    if (id === 'fDe') filtro.de = e.target.value;
    if (id === 'fAte') filtro.ate = e.target.value;
    atualizarFiltrosData(); carregarPedidos();
  });
  $('#fDatas').addEventListener('click', e => {
    const b = e.target.closest('[data-passo]'); if (!b) return;
    filtro.dia = somarDiasIso(filtro.dia || hojeISO(), Number(b.dataset.passo)); atualizarFiltrosData(); carregarPedidos();
  });
  $('#fDias').addEventListener('click', e => {
    const b = e.target.closest('[data-fdia]'); if (!b) return;
    if (b.dataset.fdia === 'outro') { filtro.periodo = 'dia'; filtro.dia = filtro.dia || hojeISO(); atualizarFiltrosData(); carregarPedidos(); $('#fDia')?.showPicker?.(); $('#fDia')?.focus(); return; }
    const mesmo = filtro.periodo === 'dia' && filtro.dia === b.dataset.fdia;
    filtro.periodo = mesmo ? 'proximas' : 'dia'; if (!mesmo) filtro.dia = b.dataset.fdia;   // tocar de novo no dia desmarca
    atualizarFiltrosData(); carregarPedidos();
  });
  el.querySelector('.chips').addEventListener('click', e => {
    const b = e.target.closest('[data-fst]'); if (!b) return;
    filtro.status = b.dataset.fst;
    $$('[data-fst]', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    carregarPedidos(); contarDias();
  });
  el.querySelector('[data-limpar-extra]')?.addEventListener('click', () => { filtro.extra = null; telaPedidos(el); });
  atualizarFiltrosData();
  carregarPedidos();
  contarDias();
}
/** Campos de data (um dia ou entre datas), os botões dos próximos dias e o contador de "Mais filtros". */
function atualizarFiltrosData() {
  const box = $('#fDatas'); if (!box) return;
  $('#fPeriodo').value = filtro.periodo;
  if (filtro.periodo === 'dia') {
    box.innerHTML = `<button type="button" class="btn icon ghost" data-passo="-1" aria-label="Dia anterior" title="Dia anterior">${ic('voltar')}</button>
      <label class="sr" for="fDia">Dia da retirada</label><input class="in" type="date" id="fDia" value="${esc(filtro.dia)}">
      <button type="button" class="btn icon ghost f-prox" data-passo="1" aria-label="Próximo dia" title="Próximo dia">${ic('voltar')}</button>
      <span class="f-dia-nome">${esc(nomeDia(filtro.dia))}</span>`;
  } else if (filtro.periodo === 'entre') {
    box.innerHTML = `<label class="f-de">De <input class="in" type="date" id="fDe" value="${esc(filtro.de)}"></label>
      <label class="f-de">até <input class="in" type="date" id="fAte" value="${esc(filtro.ate)}" ${filtro.de ? `min="${esc(filtro.de)}"` : ''}></label>`;
  } else box.innerHTML = '';
  box.hidden = !box.innerHTML;
  // "Dia da semana" não faz sentido com um dia só
  const sem = $('#fSemana'); if (sem) { sem.disabled = filtro.periodo === 'dia'; sem.title = sem.disabled ? 'Com um dia escolhido, o dia da semana não se aplica.' : ''; }
  const n = filtrosExtrasAtivos(), cont = $('#fCont'); if (cont) { cont.textContent = n; cont.hidden = !n; }
  desenharDias();
}
/* Próximos 14 dias, com quantos pedidos tem em cada um (respeita status, origem e pagamento) */
let contagemDias = {};
async function contarDias() {
  const h = hojeISO();
  try { contagemDias = await api.admin.pedidos.contarPorDia({ ...filtrosComuns(), de: h, ate: hojeISO(13) }); } catch (e) { contagemDias = {}; }
  desenharDias();
}
function desenharDias() {
  const box = $('#fDias'); if (!box) return;
  const dias = Array.from({ length: 14 }, (_, i) => hojeISO(i));
  const forDaFaixa = filtro.periodo === 'dia' && filtro.dia && !dias.includes(filtro.dia);
  box.innerHTML = dias.map((iso, i) => {
    const n = contagemDias[iso] || 0, on = filtro.periodo === 'dia' && filtro.dia === iso, dow = diaDaSemanaIso(iso);
    const rot = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : NOMES_DIA[dow].slice(0, 3);
    return `<button type="button" class="dia-ret ${dow === 0 ? 'domingo' : ''}" data-fdia="${iso}" aria-pressed="${on}" aria-label="${esc(nomeDia(iso))}: ${n} ${n === 1 ? 'pedido' : 'pedidos'}">
      <span class="dr-sem">${rot}</span><b>${iso.slice(8, 10)}/${iso.slice(5, 7)}</b><span class="dr-n">${n ? `${n} ${n === 1 ? 'pedido' : 'pedidos'}` : '—'}</span></button>`;
  }).join('') + `<button type="button" class="dia-ret outro" data-fdia="outro" aria-pressed="${forDaFaixa}">${ic('hoje')}<span class="dr-n">${forDaFaixa ? esc(nomeDia(filtro.dia)) : 'Outro dia'}</span></button>`;
}
/** Datas (AAAA-MM-DD) entre ini e fim que caem no dia da semana pedido. */
function datasNoDiaDaSemana(ini, fim, dow) {
  const out = [];
  for (let d = ini, n = 0; d <= fim && n < 800; d = somarDiasIso(d, 1), n++) if (diaDaSemanaIso(d) === dow) out.push(d);
  return out;
}
function consultaPedidos() {
  const f = { busca: filtro.busca, porPagina: 30, ...filtrosComuns() };
  const h = hojeISO();
  let de = null, ate = null, antesDe = null, crescente = true;
  switch (filtro.periodo) {
    case 'proximas': de = h; break;
    case 'semana': de = h; ate = hojeISO(6); break;
    case 'dia': de = ate = filtro.dia || h; break;
    case 'entre': de = filtro.de || null; ate = filtro.ate || null; break;
    case 'atrasadas': antesDe = h; crescente = false; break;
    case 'todas': crescente = false; break;
  }
  // buscar sem escolher período procura em todas as datas (achar o pedido de um cliente), do mais novo para o mais antigo
  if (filtro.busca.trim() && filtro.periodo === 'proximas') { de = null; crescente = false; }
  // dia da semana (ex.: só os domingos): as datas do período que caem nesse dia (sem data marcada: último ano e próximos 6 meses)
  if (filtro.diaSemana !== '' && filtro.periodo !== 'dia') {
    const ini = de || hojeISO(-365), fim = ate || (antesDe ? hojeISO(-1) : hojeISO(183));
    f.datas = datasNoDiaDaSemana(ini, fim, Number(filtro.diaSemana));
  }
  if (de) f.de = de;
  if (ate) f.ate = ate;
  if (antesDe) f.antesDe = antesDe;
  if (filtro.extra === 'novos') { f.ordenarPor = 'criado_em'; crescente = false; }
  if (filtro.ordem === 'retirada') { delete f.ordenarPor; crescente = true; }
  if (filtro.ordem === 'retirada_desc') { delete f.ordenarPor; crescente = false; }
  if (filtro.ordem === 'criado') { f.ordenarPor = 'criado_em'; crescente = false; }
  f.crescente = crescente;
  return f;
}
/** "para domingo, 11/10 · só aos domingos" etc., para o rodapé da lista */
function descricaoFiltro() {
  const p = { proximas: 'de hoje em diante', semana: 'nos próximos 7 dias', atrasadas: 'com a retirada já passada', todas: 'em todas as datas' }[filtro.periodo];
  const partes = [filtro.periodo === 'dia' ? `para ${nomeDia(filtro.dia || hojeISO())}`
    : filtro.periodo === 'entre' ? (filtro.de && filtro.ate ? `de ${formatarData(filtro.de).slice(0, 5)} a ${formatarData(filtro.ate).slice(0, 5)}` : filtro.de ? `a partir de ${formatarData(filtro.de).slice(0, 5)}` : filtro.ate ? `até ${formatarData(filtro.ate).slice(0, 5)}` : 'em todas as datas')
    : filtro.busca.trim() && filtro.periodo === 'proximas' ? 'em todas as datas' : p];
  if (filtro.diaSemana !== '' && filtro.periodo !== 'dia') partes.push(`só ${FILTRO_DIAS_SEMANA.find(([v]) => v === filtro.diaSemana)[1].toLowerCase().replace(/^/, filtro.diaSemana === '0' || filtro.diaSemana === '6' ? 'aos ' : 'às ')}`);
  if (filtro.origem) partes.push(`origem: ${ORIGENS[filtro.origem]}`);
  if (filtro.pagamento) partes.push(PAGAMENTOS_FILTRO.find(([v]) => v === filtro.pagamento)[1].toLowerCase());
  return partes.join(' · ');
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
      : `<div class="vazio"><h2>Nenhum pedido ${esc(descricaoFiltro())}</h2><p>${filtro.busca ? 'Nada encontrado para essa busca.' : 'Tente outro dia, período ou status.'}</p>
          ${filtroMudou() ? '<button type="button" class="btn ghost" data-limpar-filtros style="margin-top:12px">Limpar filtros</button>' : ''}</div>`;
    $('#pedResumo').innerHTML = `${totalPedidos ? `<b>${totalPedidos} ${totalPedidos === 1 ? 'pedido' : 'pedidos'}</b> ${esc(descricaoFiltro())}` : ''}${filtroMudou() ? ' <button type="button" class="link" data-limpar-filtros>Limpar filtros</button>' : ''}`;
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
  // módulo de topos: "Criar pedido de topo" ou o status do que já foi criado (preenchido por toposDaGaveta)
  const vaga = topper && isAdmin() ? `<span class="it-topo" data-topo-vinc="${esc(i.id)}"></span>` : '';
  return obs + (imagem
    ? `<div class="it-ref"><a class="it-ref-img" href="${esc(imagem)}" target="_blank" rel="noopener" title="Abrir a imagem"><img src="${esc(imagem)}" alt="Imagem de referência de ${esc(i.nome)}" loading="lazy"></a>
        <div class="it-ref-acoes"><span>Imagem de referência</span>
          <button type="button" class="btn sm wa" data-gav="topo" data-item="${esc(i.id)}">${ic('wa')}Enviar para quem faz o topo</button>
          <label class="btn sm ghost" for="refIt-${esc(i.id)}">${ic('foto')}Trocar imagem</label>${vaga}</div></div>${inp}`
    : `<div class="it-ref sem"><span>${ic('alerta')}Sem imagem de referência</span><label class="btn sm ghost" for="refIt-${esc(i.id)}">${ic('foto')}Anexar imagem</label>${vaga}</div>${inp}`);
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

/* ---- Conteúdo dos kits: a descrição do produto no Cardápio (o pedido guarda só o nome do kit) ---- */
let kitsCache = null;
async function mapaKitsLoja() {
  if (kitsCache && Date.now() - kitsCache.em < 5 * 60e3) return kitsCache.mapa;
  let mapa;
  try { mapa = mapaKits(await api.admin.produtos.listarCompleto()); }   // inclui kits que saíram do site
  catch (e) { try { mapa = mapaKits(achatarCardapio(await carregarCardapioAtivo())); } catch (e2) { mapa = kitsCache?.mapa || new Map(); } }
  kitsCache = { em: Date.now(), mapa };
  return mapa;
}
const kitDoItem = i => conteudoKit(i, kitsCache?.mapa);

/* ---- Impressão na térmica (bobina de 80 mm, 72 mm de área de impressão) ----
   A térmica não tem tons de cinza (203 dpi): letra fina ou pequena, cinza e linha pontilhada saem
   falhadas. Por isso: preto puro, tudo em negrito, nada menor que 13 px, Tahoma/Verdana (feitas para
   baixa resolução) e linhas cheias. */
const CSS_TERMICA = `
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; color: #000 !important; }
    html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { width: 80mm; padding: 3mm 4mm 8mm; font: 700 14px/1.35 Tahoma, Verdana, "Segoe UI", Arial, sans-serif; }
    b, strong { font-weight: 900; }`;
/** Cupom do pedido ("Imprimir 80 mm"). Com vários pedidos, cada um começa numa página nova:
    a térmica corta entre eles quando está configurada para cortar a cada página. */
const CSS_CUPOM = `
    body { padding: 0 4mm; } .cupom { padding: 3mm 0 8mm; } .cupom + .cupom { break-before: page; page-break-before: always; }
    .c { text-align: center; } .loja { font-size: 19px; font-weight: 900; } .sub { font-size: 13px; }
    .cod { font-size: 28px; font-weight: 900; letter-spacing: 1px; margin-top: 4px; }
    .sep { border-top: 2px solid #000; margin: 7px 0; } .sep.fino { border-top-width: 1px; margin: 5px 0; } .sep.forte { border-top-width: 3px; }
    .ret { border: 3px solid #000; padding: 5px 6px; margin: 7px 0; text-align: center; }
    .ret small { display: block; font-size: 13px; letter-spacing: 1px; } .ret b { display: block; font-size: 20px; line-height: 1.2; }
    .l { display: flex; justify-content: space-between; gap: 8px; } .l > span:last-child { white-space: nowrap; text-align: right; }
    .t { font-size: 15px; font-weight: 900; letter-spacing: 1px; margin: 2px 0 4px; }
    .it .n { font-size: 15px; font-weight: 900; } .it .d { font-size: 13px; margin-left: 10px; } .it .ob, .it .kit { font-weight: 900; }
    .tot { font-size: 18px; font-weight: 900; } .falta { font-size: 17px; font-weight: 900; }
    .box { border: 2px solid #000; padding: 4px 6px; margin: 6px 0; font-size: 13px; } .box b { display: block; }
    .pix .k { display: block; font-size: 19px; font-weight: 900; letter-spacing: .5px; }
    .pe { text-align: center; font-size: 13px; margin-top: 8px; }`;
/** O cupom de um pedido completo (como o da gaveta, com as anotações): igual para um pedido ou vários. Carregue mapaKitsLoja() antes. */
function cupomTermica(p, loja, pix) {
  const pct = Number(p.percentual_sinal ?? 50).toLocaleString('pt-BR');
  const falta = Math.max(0, Number(p.saldo ?? (p.total - p.valor_pago)));
  const l = (a, b, cls = '') => `<div class="l ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const itens = p.itens.map(i => {
    const { texto, imagem } = separarReferencia(i.observacao);
    const det = [i.massa && `Massa: ${i.massa}`, i.formato && `Formato: ${i.formato}`, i.segundo_recheio && `2º recheio: ${i.segundo_recheio}`].filter(Boolean);
    const kit = kitDoItem(i);
    return `<div class="it">${l(`<b class="n">${i.quantidade}x ${esc(i.nome)}${i.peso_kg ? ' ' + esc(formatarPeso(i.peso_kg)) : ''}</b>`, R(i.subtotal))}
      ${det.map(d => `<div class="d">${esc(d)}</div>`).join('')}
      ${kit ? `<div class="d kit"><b>Vem no kit:</b> ${esc(kit)}</div>` : ''}
      ${i.quantidade > 1 ? `<div class="d">${i.quantidade} x ${R(i.preco_unitario)}</div>` : ''}
      ${texto ? `<div class="d ob">Obs: ${esc(texto)}</div>` : ''}${imagem ? '<div class="d ob">* Imagem de referência anexada (ver no sistema)</div>' : ''}</div>`;
  }).join('<div class="sep fino"></div>');
  const fixadas = (p.observacoes || []).filter(o => o.fixada);
  return `<section class="cupom">
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
    ${falta > 0 && pix ? `<div class="box pix"><b>Pix${pix.tipo ? ` (${esc(pix.tipo)})` : ''}</b><span class="k">${esc(pix.chave)}</span>${esc(pix.nome)}</div>` : ''}
    <div class="pe">${loja.whatsapp_exibicao ? 'WhatsApp ' + esc(loja.whatsapp_exibicao) + '<br>' : ''}Impresso em ${esc(dataHora(new Date().toISOString()))}</div>
  </section>`;
}
/** Um ou mais pedidos completos na térmica, numa impressão só (uma janela de impressão), na ordem recebida. */
async function imprimirCupons(pedidos) {
  const cfg = await configLoja(), loja = cfg || {}, pix = pixDe(cfg);
  await mapaKitsLoja();
  const titulo = pedidos.length === 1 ? `Pedido ${pedidos[0].codigo}` : `${pedidos.length} pedidos`;
  return mandarParaTermica(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS_TERMICA}${CSS_CUPOM}
  </style></head><body>${pedidos.map(p => cupomTermica(p, loja, pix)).join('')}</body></html>`);
}
function imprimirTermica(p) { return imprimirCupons([p]); }
/** Uma impressão de cada vez (as automáticas podem chegar juntas). Resolve quando a impressão foi enviada. */
let filaTermica = Promise.resolve();
function mandarParaTermica(html) {
  const vez = filaTermica.then(() => new Promise(fim => {
    $('#impTermica')?.remove();
    const f = document.createElement('iframe');
    f.id = 'impTermica'; f.title = 'Impressão'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    f.onload = () => setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { erroToast(e); }
      setTimeout(fim, 600);
    }, 120);
    f.srcdoc = html;
    document.body.appendChild(f);
  }));
  filaTermica = vez.catch(() => {});
  return vez;
}

/* ---- Etiqueta do pedido (80 mm): para colar na caixa. Código e nome grandes, retirada e itens ---- */
async function imprimirEtiqueta(p) {
  const loja = await configLoja() || {};
  await mapaKitsLoja();
  const falta = Math.max(0, Number(p.saldo ?? (p.total - p.valor_pago)));
  const itens = p.itens.map(i => {
    const det = [i.peso_kg && formatarPeso(i.peso_kg), i.massa, i.formato, i.segundo_recheio && `2º recheio: ${i.segundo_recheio}`].filter(Boolean).join(' · ');
    const obs = separarReferencia(i.observacao).texto, kit = kitDoItem(i);
    return `<li><b>${i.quantidade}x ${esc(i.nome)}</b>${det ? `<span>${esc(det)}</span>` : ''}${kit ? `<span class="ob">Vem no kit: ${esc(kit)}</span>` : ''}${obs ? `<span class="ob">Obs: ${esc(obs)}</span>` : ''}</li>`;
  }).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiqueta ${esc(p.codigo)}</title><style>${CSS_TERMICA}
    body { padding-bottom: 6mm; }
    .loja { text-align: center; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
    .cod { text-align: center; font-size: 36px; font-weight: 900; letter-spacing: 1px; line-height: 1.1; margin: 2px 0; }
    .cli { text-align: center; font-size: 22px; font-weight: 900; line-height: 1.15; overflow-wrap: anywhere; }
    .ret { border: 3px solid #000; padding: 5px 6px; margin: 7px 0; text-align: center; }
    .ret small { display: block; font-size: 13px; letter-spacing: 1px; }
    .ret b { display: block; font-size: 22px; line-height: 1.15; }
    ul { list-style: none; border-top: 2px solid #000; padding-top: 5px; }
    li { padding: 3px 0; } li b { font-size: 15px; } li span { display: block; font-size: 13px; margin-left: 10px; } li .ob { font-weight: 900; }
    .pg { margin-top: 6px; border-top: 3px solid #000; padding-top: 5px; text-align: center; font-size: 19px; font-weight: 900; }
    .obs { margin-top: 6px; border: 2px solid #000; padding: 4px 6px; font-size: 13px; }
  </style></head><body>
    <div class="loja">${esc(loja.nome_loja || 'Rita Bolos')}</div>
    <div class="cod">${esc(p.codigo)}</div>
    <div class="cli">${esc(p.cliente_nome)}</div>
    <div class="ret"><small>RETIRADA</small><b>${esc(dataCurta(p.data_retirada).toUpperCase())}${p.hora_retirada ? ' · ' + esc(hora(p.hora_retirada)) : ''}</b></div>
    <ul>${itens}</ul>
    ${p.observacao_cliente ? `<div class="obs"><b>Obs. do cliente:</b> ${esc(p.observacao_cliente)}</div>` : ''}
    <div class="pg">${falta > 0 ? `FALTA PAGAR ${esc(R(falta))}` : 'PAGO'}</div>
  </body></html>`;
  return mandarParaTermica(html);
}

/* =========================================================
   NIIMBOT (impressora de etiquetas por Bluetooth)
   Usa a NiimBlueLib (código aberto, licença MIT: github.com/MultiMote/niimbluelib), que fala direto com
   a impressora pelo Bluetooth do navegador, sem o aplicativo da Niimbot. Funciona no Chrome/Edge do
   computador e no Chrome do Android; no iPhone o navegador não tem Bluetooth. A conexão vale enquanto o
   backoffice está aberto (ao recarregar, tenta reconectar sozinho; se não der, avisa para tocar em Conectar).
========================================================= */
const NIIMBLUELIB_URL = 'https://cdn.jsdelivr.net/npm/@mmote/niimbluelib@0.47.0/dist/umd/niimbluelib.min.js';
const TAMANHOS_ETIQUETA = [['50x30', '50 × 30 mm'], ['40x30', '40 × 30 mm'], ['50x20', '50 × 20 mm'], ['40x40', '40 × 40 mm'], ['50x50', '50 × 50 mm'],
  ['30x20', '30 × 20 mm'], ['40x12', '40 × 12 mm (D11, D110)'], ['30x15', '30 × 15 mm (D11, D110)']];
const CHAVE_NIIMBOT = 'ritabolos.niimbot';
function confNiimbot() {
  try { return { usar: false, tamanho: '50x30', conteudo: 'producao', ...JSON.parse(localStorage.getItem(CHAVE_NIIMBOT) || '{}') }; } catch (e) { return { usar: false, tamanho: '50x30', conteudo: 'producao' }; }
}
function salvarConfNiimbot(c) { try { localStorage.setItem(CHAVE_NIIMBOT, JSON.stringify({ ...confNiimbot(), ...c })); } catch (e) { /* sem armazenamento */ } }
let niim = null;                       // { lib, client, nome }
let filaNiimbot = Promise.resolve();
const niimbotConectada = () => !!niim?.client?.isConnected();

async function carregarNiimblue() {
  if (window.niimbluelib) return window.niimbluelib;
  await new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = NIIMBLUELIB_URL; s.onload = ok;
    s.onerror = () => { s.remove(); falha(new Error('Não deu para carregar o módulo da Niimbot. Confira a internet e tente de novo.')); };
    document.head.appendChild(s);
  });
  return window.niimbluelib;
}
/** Conecta (abre a lista do Bluetooth para escolher a impressora). Precisa vir de um toque. device: impressora já autorizada antes. */
async function conectarNiimbot(device) {
  if (!navigator.bluetooth) throw new Error('Este navegador não conecta por Bluetooth. Use o Chrome (ou o Edge) no computador, ou o Chrome no Android. No iPhone não funciona.');
  const lib = await carregarNiimblue();
  try { await niim?.client?.disconnect(); } catch (e) { /* já estava desconectada */ }
  const client = lib.instantiateClient('bluetooth');
  client.on('disconnect', () => { if (niim?.client === client) atualizarIndicadorNiimbot(); });
  let info;
  try { info = await client.connect(device ? { authorizedDevice: device } : undefined); }
  catch (e) {
    if (/cancel/i.test(e?.message || '') || e?.name === 'NotFoundError') throw new Error('Nenhuma impressora escolhida. Ligue a Niimbot e toque em Conectar de novo.');
    throw new Error(`Não deu para conectar na Niimbot: ${e?.message || e}`);
  }
  const meta = client.getModelMetadata();
  niim = { lib, client, nome: meta?.model || info?.deviceName || 'Niimbot' };
  salvarConfNiimbot({ ultimaImpressora: info?.deviceName || null });
  atualizarIndicadorNiimbot();
  return niim;
}
/** Ao abrir o backoffice: reconecta sozinho à impressora já autorizada, quando o navegador deixa. */
async function reconectarNiimbot() {
  const c = confNiimbot();
  if (!c.usar || niimbotConectada() || !navigator.bluetooth?.getDevices) { atualizarIndicadorNiimbot(); return; }
  try {
    const devices = await navigator.bluetooth.getDevices();
    const d = devices.find(x => x.name && x.name === c.ultimaImpressora) || devices.find(x => /^(B|D|H|K|A)\d/i.test(x.name || ''));
    if (d) await conectarNiimbot(d);
  } catch (e) { /* fica o aviso para conectar com um toque */ }
  atualizarIndicadorNiimbot();
}
/** Botão na barra de cima: aparece quando a Niimbot está em uso neste aparelho (verde: conectada). */
function atualizarIndicadorNiimbot() {
  const usar = confNiimbot().usar, ok = niimbotConectada();
  $$('[data-act="niimbot"]').forEach(b => {
    b.hidden = !usar;
    b.classList.toggle('on', ok); b.classList.toggle('off', !ok);
    b.title = ok ? `Niimbot conectada (${niim.nome}). Toque para desconectar.` : 'Niimbot desconectada. Toque para conectar.';
    b.setAttribute('aria-label', b.title);
  });
  const st = $('#nbStatus'); if (st) st.textContent = ok ? `Conectada: ${niim.nome}` : 'Desconectada';
  const bt = $('[data-nb-conectar]'); if (bt) bt.textContent = ok ? 'Reconectar' : 'Conectar';
}

/* ---- Etiquetas: o que sai em cada uma ----
   Produção: uma por bolo, com o que a cozinha precisa (cliente, horário, recheio, massa, formato e se tem topo).
   Pedido: uma por pedido (código, retirada, cliente, itens e quanto falta pagar). Pedido sem bolo sai assim. */
const CONTEUDOS_ETIQUETA = [['producao', 'Produção: uma por bolo (cliente, horário, recheio, massa, formato e topo)'], ['pedido', 'Pedido: uma por pedido (código, cliente, itens e pagamento)']];
/** Bolo inteiro na descrição de um kit: "Bolo de 1 kg", "1,5 kg de bolo" (uma fatia não conta). */
const BOLO_NO_KIT = /(\d+(?:[.,]\d+)?\s*kg\s+de\s+bolo|bolo\s+de\s+\d+(?:[.,]\d+)?\s*kg)/i;
/** Bolo para a cozinha: tem peso, massa ou formato, é um kit com bolo, ou o nome começa com "Bolo" (bolo no pote, fatia e topo não contam). */
const ehBoloProducao = i => !!(i.peso_kg || i.massa || i.formato) || BOLO_NO_KIT.test(kitDoItem(i) || '')
  || (/^bolo\b/i.test(String(i.nome || '').trim()) && !/bolo no pote|fatia/i.test(i.nome || '') && !ehTopper(i.nome, i.categoria));
const ehItemFinalizacao = i => /^finaliza[çc][ãa]o/i.test(String(i.nome || '').trim());
/** As finalizações (colorido, glitter…) de um bolo: o item diz "Bolo: <nome> <peso>"; a que não diz (ou não acha o bolo) vale para todos. */
function finalizacoesDoBolo(bolo, fins, bolos) {
  const norm = t => String(t || '').toLowerCase().replace(/\./g, ',').replace(/\s+/g, ' ').trim();
  const chaves = b => [norm(`${b.nome} ${formatarPeso(b.peso_kg)}`), norm(b.nome)];
  return fins.filter(f => {
    const alvo = norm((separarReferencia(f.observacao).texto || '').match(/^bolo:\s*(.+)$/i)?.[1]);
    return !alvo || chaves(bolo).includes(alvo) || !bolos.some(b => chaves(b).includes(alvo));
  });
}
/** As etiquetas de um pedido: [{ p, item, n, total, topos, fins }] (uma por bolo) ou [{ p }] (a do pedido). Carregue mapaKitsLoja() antes. */
function etiquetasDoPedido(p, conteudo = confNiimbot().conteudo) {
  const itens = p.itens || [];
  if (conteudo !== 'pedido') {
    const bolos = itens.filter(ehBoloProducao);
    if (bolos.length) {
      const topos = itens.filter(i => ehTopper(i.nome, i.categoria) && !bolos.includes(i));   // toppers avulsos (o que vem no kit sai na etiqueta do kit)
      const fins = itens.filter(ehItemFinalizacao);
      const total = bolos.reduce((s, i) => s + Math.max(1, Number(i.quantidade) || 1), 0), out = [];
      bolos.forEach(i => {
        const f = finalizacoesDoBolo(i, fins, bolos);
        for (let k = 0; k < Math.max(1, Number(i.quantidade) || 1); k++) out.push({ p, item: i, n: out.length + 1, total, topos, fins: f });
      });
      return out;
    }
  }
  return [{ p }];
}
const diaEtiqueta = iso => (iso ? `${DIAS[new Date(iso + 'T12:00:00Z').getUTCDay()].toUpperCase()} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
/** "2 kg" não se separa na quebra de linha. */
const colarPeso = t => String(t || '').replace(/(\d)\s+(kg|g)\b/gi, '$1\u00a0$2');

/** Desenha a etiqueta num canvas do tamanho dela (pxmm: pontos por mm da impressora), já em preto e branco. */
function canvasEtiqueta(et, W, H, pxmm, loja = {}) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.strokeStyle = '#000';
  const k = {
    g, W, H, M: Math.max(4, Math.round(pxmm * 1.2)), mm: v => v * pxmm, traco: Math.max(2, Math.round(pxmm * 0.3)),   // margem de ~1,2 mm
    fonte: (px, peso = 800) => `${peso} ${Math.max(8, Math.round(px))}px Arial, "Helvetica Neue", Helvetica, sans-serif`,
    escrever: (t, x, y, alinhar = 'left') => { g.textAlign = alinhar; g.fillText(t, x, y); },
    cortar(t, max) { if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t.trimEnd() + '…'; }
  };
  k.largura = W - 2 * k.M;
  k.medir = (t, px, peso) => { g.font = k.fonte(px, peso); return g.measureText(t).width; };
  k.encaixar = (t, px, peso, max) => {   // diminui a letra até caber
    const w = k.medir(t, px, peso);
    if (w > max) px = Math.max(9, Math.floor(px * max / w) + 1);   // a largura cresce junto com a letra: já chega perto
    while (px > 9 && k.medir(t, px, peso) > max) px -= 1;
    return px;
  };
  k.quebrar = (texto, max, maxLinhas) => {   // quebra nos espaços (o espaço fixo não quebra); se não couber tudo, a última linha termina com "…"
    const palavras = String(texto).split(/[ \t\r\n]+/).filter(Boolean), linhas = [];
    let atual = '', i = 0;
    for (; i < palavras.length; i++) {
      const t = atual ? `${atual} ${palavras[i]}` : palavras[i];
      if (g.measureText(t).width <= max || !atual) atual = t;
      else { linhas.push(atual); atual = palavras[i]; if (linhas.length === maxLinhas) break; }
    }
    if (linhas.length < maxLinhas && atual) { linhas.push(atual); i = palavras.length; }
    if (i < palavras.length && linhas.length) linhas[linhas.length - 1] = k.cortar(`${linhas[linhas.length - 1]} …`, max);
    return linhas.map(l => k.cortar(l, max));
  };
  /** O texto numa linha, diminuindo a letra até a fração "menor" (nunca abaixo de 1,6 mm, que a térmica não marca bem);
      se não der, tenta as versões seguintes (mais curtas); se nenhuma couber, quebra a última em até "linhas" linhas
      ou corta com "…" (cortado: true). Volta [{ t, f, peso, cortado }]. */
  k.texto = (opcoes, px, peso, max, { linhas = 1, menor = 0.8 } = {}) => {
    const lista = [].concat(opcoes).filter(Boolean), min = Math.min(px, Math.max(px * menor, pxmm * 1.6));
    if (!lista.length) return [{ t: '', f: px, peso }];
    for (const t of lista) { const f = k.encaixar(t, px, peso, max); if (f >= min && k.medir(t, f, peso) <= max) return [{ t, f, peso }]; }
    const t = lista[lista.length - 1];
    if (linhas > 1) { g.font = k.fonte(px, peso); return k.quebrar(t, max, linhas).map(l => ({ t: l, f: px, peso, cortado: l.endsWith('…') })); }
    g.font = k.fonte(min, peso); const c = k.cortar(t, max);
    return [{ t: c, f: min, peso, cortado: c !== t }];
  };
  if (et.item) desenharEtiquetaBolo(k, et); else desenharEtiquetaPedido(k, et.p || et, loja);
  // preto e branco "duro": a impressora não tem cinza, e a borda suave das letras sairia borrada
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const preto = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 150; d[i] = d[i + 1] = d[i + 2] = preto ? 0 : 255; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
/* Linhas empilhadas de cima para baixo: { t, f, peso, antes (espaço acima), dir: [{ t, f, peso }] (à direita, na mesma linha),
   selo: { t, f, cheio } (à direita; cheio = fundo preto), faixa (fundo preto na largura toda), regra (traço) } */
const alturaLinha = (k, l) => (l.antes || 0) + (l.regra ? k.traco : l.faixa ? l.f * 1.32
  : Math.max(l.f, ...(l.dir || []).map(x => x.f), l.selo ? l.selo.f * 1.15 : 0) * 0.8 + l.f * 0.22);
const alturaLinhas = (k, L) => L.reduce((s, l) => s + alturaLinha(k, l), 0);
function desenharLinhas(k, L, y) {
  const { g, W, M, largura, mm, fonte, escrever, traco } = k;
  for (const l of L) {
    y += l.antes || 0;
    if (l.regra) { g.fillRect(M, y, largura, traco); y += traco; continue; }
    if (l.faixa) {
      const h = l.f * 1.32; g.fillRect(M, y, largura, h);
      g.fillStyle = '#fff'; g.font = fonte(l.f, l.peso); escrever(l.t, M + mm(1), y + h * 0.76); g.fillStyle = '#000';
      y += h; continue;
    }
    const base = y + Math.max(l.f, ...(l.dir || []).map(x => x.f), l.selo ? l.selo.f * 1.15 : 0) * 0.8;
    if (l.t) { g.font = fonte(l.f, l.peso); escrever(l.t, M, base); }
    let x = W - M;
    for (const d of [...(l.dir || [])].reverse()) { g.font = fonte(d.f, d.peso); escrever(d.t, x, base, 'right'); x -= g.measureText(d.t).width + mm(0.8); }
    if (l.selo) {
      g.font = fonte(l.selo.f, 900);
      if (l.selo.cheio) {
        const w = g.measureText(l.selo.t).width + mm(1.2);
        g.fillRect(x - w, base - l.selo.f * 0.92, w, l.selo.f * 1.15);
        g.fillStyle = '#fff'; escrever(l.selo.t, x - mm(0.6), base, 'right'); g.fillStyle = '#000';
      } else escrever(l.selo.t, x, base, 'right');
    }
    y = base + l.f * 0.22;
  }
  return y;
}
/** Largura do que vai à direita na linha (horário, selo), com o respiro até o texto da esquerda. */
const larguraDireita = (k, dir = [], selo) => {
  const w = dir.reduce((s, x) => s + k.medir(x.t, x.f, x.peso), 0) + Math.max(0, dir.length - 1) * k.mm(0.8)
    + (selo ? k.medir(selo.t, selo.f, 900) + (selo.cheio ? k.mm(1.2) : 0) : 0);
  return w ? w + k.mm(1.5) : 0;
};
/** Etiqueta do pedido: código grande, dia e horário, cliente, itens e pagamento. */
function desenharEtiquetaPedido(k, p, loja) {
  const { g, W, H, M, largura, mm, fonte, medir, encaixar, cortar, escrever, quebrar } = k;
  const dia = diaEtiqueta(p.data_retirada), horario = p.hora_retirada ? hora(p.hora_retirada) : '';
  const falta = Math.max(0, Number(p.saldo ?? (Number(p.total) - Number(p.valor_pago))));
  const pagto = falta > 0 ? `FALTA ${R(falta).replace(/ /g, ' ')}` : 'PAGO';
  const itens = (p.itens || []).map(i => `${i.quantidade}x\u00a0${i.nome}${i.peso_kg ? ' ' + colarPeso(formatarPeso(i.peso_kg)) : ''}`).join(' · ');
  const estreita = H < mm(20);
  // código grande; à direita, o dia em cima e o horário embaixo
  let fDia = estreita ? Math.min(mm(5.5), H * 0.46) * 0.42 : mm(3.1), fHora = estreita ? Math.min(mm(5.5), H * 0.46) * 0.62 : mm(4.6);
  let bloco = Math.max(dia ? medir(dia, fDia, 800) : 0, horario ? medir(horario, fHora, 900) : 0);
  if (bloco > largura * 0.44) { const r = largura * 0.44 / bloco; fDia *= r; fHora *= r; bloco *= r; }   // etiqueta estreita: o código continua grande
  const fCod = encaixar(p.codigo, estreita ? Math.min(mm(5.5), H * 0.46) : mm(6.2), 900, largura - bloco - mm(estreita ? 1.5 : 2));
  const topo = estreita ? M * 0.6 : M;
  const base = topo + Math.max(fCod * 0.78, (dia ? fDia * 0.8 + mm(estreita ? 0.5 : 0.8) : 0) + (horario ? fHora * 0.78 : 0));
  g.font = fonte(fCod, 900); escrever(p.codigo, M, base);
  if (dia) { g.font = fonte(fDia, 800); escrever(dia, W - M, horario ? topo + fDia * 0.8 : base, 'right'); }
  if (horario) { g.font = fonte(fHora, 900); escrever(horario, W - M, base, 'right'); }
  if (estreita) {   // D11, D110: só o nome embaixo
    const fN = encaixar(p.cliente_nome || '', Math.min(mm(4.2), (H - base - M * 0.6) * 0.95), 800, largura);
    g.font = fonte(fN, 800); escrever(cortar(p.cliente_nome || '', largura), M, base + mm(0.5) + fN * 0.8);
    return;
  }
  let y = base + mm(1.4);
  g.lineWidth = Math.max(2, Math.round(mm(0.3))); g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();
  const fN = encaixar(p.cliente_nome || '', mm(4.2), 800, largura);
  y += mm(1.2) + fN * 0.8; g.font = fonte(fN, 800); escrever(cortar(p.cliente_nome || '', largura), M, y);
  const fP = mm(3.4), rodape = H - M;   // linha do pagamento, colada embaixo
  const fI = mm(2.8), entre = fI * 1.2, nLinhas = Math.max(0, Math.floor((rodape - fP - mm(1) - y) / entre));
  if (nLinhas && itens) { g.font = fonte(fI, 700); quebrar(itens, largura, nLinhas).forEach((l, i) => escrever(l, M, y + mm(0.6) + (i + 1) * entre - fI * 0.2)); }
  const fPg = encaixar(pagto, fP, 900, largura * 0.62);
  g.font = fonte(fPg, 900); escrever(pagto, W - M, rodape, 'right');
  const nomeLoja = loja.nome_loja || 'Rita Bolos';
  if (medir(nomeLoja, mm(2.4), 700) <= largura - medir(pagto, fPg, 900) - mm(2)) { g.font = fonte(mm(2.4), 700); escrever(nomeLoja, M, rodape); }   // só se couber inteiro
}
/** O que vai na etiqueta de um bolo, já em texto. */
function textosEtiquetaBolo({ p, item: i, n, total, topos = [], fins = [] }) {
  const kit = kitDoItem(i) || '';
  const boloKit = !i.peso_kg && !i.massa ? kit.match(BOLO_NO_KIT)?.[0] : '';   // kit: o bolo que vem nele
  const kitComTopo = !!kit && /\btopper|\btopos?\b/i.test(`${i.nome} ${kit}`);
  const q = topos.reduce((s, t) => s + Math.max(1, Number(t.quantidade) || 1), 0), tb = `${q} topo${q > 1 ? 's' : ''}`;   // toppers avulsos no pedido
  const juntar = t => colarPeso(t).replace(/\s*\+\s*/g, '\u00a0+\u00a0');   // "Ninho + Morango" não quebra no "+"
  const sabor = String(i.nome || '').replace(/^bolo\s+(d[aeo]s?\s+)?/i, '');
  return {
    nome: String(p.cliente_nome || '').trim(), horario: p.hora_retirada ? hora(p.hora_retirada) : '', dia: diaEtiqueta(p.data_retirada), codigo: p.codigo || '',
    qual: total > 1 ? `bolo ${n} de ${total}` : '',
    recheio: juntar([sabor.charAt(0).toUpperCase() + sabor.slice(1), i.peso_kg ? formatarPeso(i.peso_kg) : ''].filter(Boolean).join(' ')),
    segundo: juntar(i.segundo_recheio || ''), boloKit: colarPeso(boloKit),
    massa: String(i.massa || '').replace(/^massa\s+/i, '').toUpperCase(), formato: String(i.formato || '').toUpperCase(),
    fin: fins.map(f => String(f.nome).trim().replace(/^finaliza[çc][ãa]o\s*/i, '')).filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', '),
    topo: [kitComTopo ? 'vem no kit' : '', ...topos.map(t => (Number(t.quantidade) > 1 ? `${t.quantidade}x ` : '') + t.nome)].filter(Boolean).join(', '),
    // menos topos que bolos: a cozinha confere no pedido qual bolo leva
    notaTopo: !kitComTopo && q && q < total ? [`${tb} para ${total} bolos: confira no pedido`, `${tb} p/ ${total} bolos: ver pedido`, `${tb} p/ ${total} bolos`] : [],
    obs: separarReferencia(i.observacao).texto || ''
  };
}
/** "Maria Aparecida dos Santos" → ["Maria Aparecida dos Santos", "Maria Santos"] e, com curto, também "Maria S." e "Maria". */
const nomesCurtos = (nome, curto = true) => {
  const p = String(nome || '').split(/\s+/).filter(Boolean);
  if (p.length < 2) return [p.join(' ')];
  const ult = p[p.length - 1], bons = [p.join(' '), `${p[0]} ${ult}`];
  return [...new Set(curto ? [...bons, `${p[0]} ${ult.charAt(0).toUpperCase()}.`, p[0]] : bons)];
};
/**
 * Cliente à esquerda e horário à direita, na mesma linha. O nome tem preferência: primeiro o horário diminui, depois vale
 * o primeiro e o último nome ("Maria Santos"). Com curto, encurta mais ("Maria S.", "Maria") e, no fim, corta;
 * sem curto, volta null quando nem "Maria Santos" cabe.
 */
function cabecalhoBolo(k, d, fN, fH, { comDia = false, curto = true } = {}) {
  const nomes = nomesCurtos(d.nome, curto);
  const dir = (r, dia) => [dia && d.dia && { t: d.dia.split(' ')[0], f: fH * r * 0.55, peso: 800 }, d.horario && { t: d.horario, f: fH * r, peso: 900 }].filter(Boolean);
  if (comDia && d.dia) {   // "SÁB 16:00", se o nome inteiro continuar grande
    const D = dir(1, true), max = k.largura - larguraDireita(k, D), f = k.encaixar(nomes[0], fN, 900, max);
    if (f >= fN * 0.85 && k.medir(nomes[0], f, 900) <= max) return { t: nomes[0], f, peso: 900, dir: D };
  }
  for (const t of nomes) for (const r of [1, 0.9, 0.8, 0.7, 0.65]) {
    const D = dir(r), max = k.largura - larguraDireita(k, D), f = k.encaixar(t, fN, 900, max);
    if (f >= fN * 0.7 && k.medir(t, f, 900) <= max) return { t, f, peso: 900, dir: D };
  }
  if (!curto) return null;
  const D = dir(0.65);
  return { ...k.texto(nomes, fN, 900, k.largura - larguraDireita(k, D), { menor: 0.6 })[0], dir: D };
}
/** Sem "cortado": a linha pode sair cortada sem prejudicar (o essencial está no começo dela). */
const semCorte = ({ cortado, ...l }) => l;
/**
 * Procura o maior tamanho (s = 1: o ideal; s < 1: tudo diminui junto) em que as linhas cabem na altura sem cortar nada.
 * etapas: [[[montar(s) → linhas ou null, ...], s mínimo], ...], na ordem de preferência; dentro da etapa, ganha o arranjo
 * que deixa a letra maior (no empate, o primeiro). Se nenhuma servir sem cortar: a que coube na altura com menos linhas cortadas.
 */
function escolherTamanho(k, etapas, util, sMax = 1) {
  let reserva = null;
  for (const [arranjos, sMin] of etapas) {
    for (let s = sMax; s >= sMin - 1e-6; s -= 0.05) {
      for (const montar of arranjos) {
        const L = montar(s);
        if (!L || alturaLinhas(k, L) > util) continue;
        const cortes = L.filter(l => l.cortado).length;
        if (!cortes) return L;
        if (!reserva || cortes < reserva.cortes) reserva = { L, cortes };
      }
    }
  }
  return reserva?.L || null;
}
/**
 * Etiqueta de um bolo para a cozinha: cliente e horário; dia, código e qual bolo é; recheio e peso; 2º recheio (ou o bolo do kit);
 * massa e formato; finalização; topo (faixa preta) ou SEM TOPO; a observação do bolo, se couber. Nada do essencial é cortado: tudo diminui junto.
 */
function desenharEtiquetaBolo(k, et) {
  const { H, M, largura, mm, texto } = k, d = textosEtiquetaBolo(et);
  if (H < mm(20)) return desenharBoloEstreita(k, d);
  const subs = [[d.dia, d.codigo, d.qual], [d.dia, d.qual]].map(a => a.filter(Boolean).join(' · '));
  const mf = [[d.massa && `MASSA ${d.massa}`, d.formato], [d.massa, d.formato]].map(a => a.filter(Boolean).join(' · '));
  /** cab: 'linha' (cliente e horário lado a lado, nome inteiro), 'duas' (o nome numa linha; embaixo, o horário com o dia e o código)
      ou 'curto' (lado a lado, o nome pode encurtar). Volta null quando o cabeçalho pedido não cabe. */
  const montar = (s, cab, comSub = true) => {
    const fN = mm(4.8) * s, fH = mm(5) * s, fS = mm(2.6) * s, L = [];
    let sub = comSub && subs[0];
    if (cab === 'duas') {
      L.push(texto(nomesCurtos(d.nome, false), fN, 900, largura, { menor: 0.55 })[0]);   // com a linha só para ele, o nome pode diminuir mais
      if (d.horario) {
        // ao lado do horário: o dia e o código; "bolo 1 de 2" não pode sumir (se não couber, vai para a linha de baixo)
        const fh = fH * 0.85, ao = sub ? texto(d.qual ? subs : [...subs, d.dia], fS, 700, largura - k.medir(d.horario, fh, 900) - mm(2), { menor: 0.85 })[0] : null;
        const lado = ao && !ao.cortado;
        L.push({ t: d.horario, f: fh, peso: 900, antes: mm(0.4) * s, dir: lado ? [semCorte(ao)] : [] });
        if (lado) sub = null;
      }
    } else {
      const c = cabecalhoBolo(k, d, fN, fH, { curto: cab === 'curto' });
      if (!c) return null;
      L.push(c);
    }
    if (sub) L.push({ ...semCorte(texto(subs, fS, 700, largura)[0]), antes: mm(0.6) * s });
    L.push({ regra: true, antes: mm(1) * s });
    L.push(...texto(d.recheio, mm(3.6) * s, 800, largura, { linhas: 4 }).map((l, n) => ({ ...l, antes: mm(n ? 0.1 : 0.7) * s })));
    if (d.segundo || d.boloKit) L.push(...texto(d.segundo ? [`2º recheio: ${d.segundo}`, `2º: ${d.segundo}`] : d.boloKit, mm(3.2) * s, 800, largura, { linhas: 2 }).map(l => ({ ...l, antes: mm(0.2) * s })));
    if (mf[0]) L.push({ ...texto(mf, mm(3.4) * s, 900, largura)[0], antes: mm(0.3) * s });
    if (d.fin) L.push({ ...texto([`Finalização: ${d.fin}`, d.fin], mm(3.0) * s, 800, largura)[0], antes: mm(0.2) * s });
    // topo: faixa preta, para ninguém deixar passar
    L.push({ ...semCorte(texto(d.topo ? `TOPO: ${d.topo}` : 'SEM TOPO', mm(3.2) * s, d.topo ? 900 : 800, largura - (d.topo ? mm(2) : 0))[0]), faixa: !!d.topo, antes: mm(0.8) * s });
    if (d.notaTopo.length) L.push({ ...texto(d.notaTopo, mm(2.7) * s, 800, largura)[0], antes: mm(0.4) * s });
    return L;
  };
  const util = H - M * 1.2;   // margem de cima (0,8) e de baixo (0,4)
  // a observação no que sobrou. modo: 'toda' (inteira ou nada), 'parte' (ao menos 1 linha), 'sobra' (o que couber, até nada)
  const obs = (s, L, modo) => {
    if (!L) return null;
    const fO = mm(2.6) * Math.max(s, 0.85), n = d.obs ? Math.min(4, Math.floor((util - alturaLinhas(k, L)) / (fO * 1.02 + mm(0.3)))) : 0;
    if (n < 1) return modo === 'sobra' ? L : null;
    const O = texto(`Obs: ${d.obs}`, fO, 700, largura, { linhas: n, menor: 1 });
    return modo === 'toda' && O.some(l => l.cortado) ? null : [...L, ...O.map(l => ({ ...semCorte(l), antes: mm(0.3) }))];
  };
  const etapa = (modo, cabs, sMin, comSub = true) => [cabs.map(cab => s => obs(s, montar(s, cab, comSub), modo)), sMin];
  // na ordem de preferência: com a observação inteira; com parte dela; só o essencial; o nome encurtado; sem a linha do dia e do código
  const etapas = [
    ...(d.obs ? [etapa('toda', ['linha', 'duas'], 0.85), etapa('parte', ['linha', 'duas'], 0.85)] : []),
    etapa('sobra', ['linha', 'duas'], 0.75), etapa('sobra', ['curto'], 0.6), etapa('sobra', ['curto'], 0.6, false)
  ];
  desenharLinhas(k, escolherTamanho(k, etapas, util, H >= mm(38) ? 1.2 : 1) || montar(0.6, 'curto', false), M * 0.8);
}
/** D11, D110 (12 a 15 mm de altura): cliente e horário; recheio; 2º recheio e finalização (se tiver); massa, formato e TOPO. */
function desenharBoloEstreita(k, d) {
  const { H, M, largura, mm, texto } = k;
  const recheios = d.boloKit ? [`${d.recheio} · ${d.boloKit}`, d.boloKit] : d.recheio;
  const mf = [d.massa, d.formato].filter(Boolean).join(' · ');   // "PRETA · REDONDO": aqui não sobra lugar para "MASSA"
  const montar = (s, curto = true) => {
    const f1 = Math.min(mm(4.6), H * 0.38) * s, f2 = Math.min(mm(3.2), H * 0.24) * s, antes = mm(0.3) * s;
    const selo = { t: d.topo ? 'TOPO' : 'SEM TOPO', f: f2 * (d.topo ? 0.9 : 1), cheio: !!d.topo };
    const cab = cabecalhoBolo(k, d, f1, f1, { comDia: true, curto });
    if (!cab) return null;
    const L = [cab, { ...texto(recheios, f2, 800, largura, { menor: 0.7 })[0], antes }];
    if (d.segundo) L.push({ ...texto([`2º recheio: ${d.segundo}`, `2º: ${d.segundo}`], f2, 800, largura, { menor: 0.7 })[0], antes });
    if (d.fin) L.push({ ...texto([`Finalização: ${d.fin}`, d.fin], f2, 800, largura, { menor: 0.7 })[0], antes });
    const lado = texto(mf, f2, 900, largura - larguraDireita(k, [], selo), { menor: 0.7 })[0];
    if (!lado.cortado) L.push({ ...lado, selo, antes });
    else L.push({ ...texto(mf, f2, 900, largura, { menor: 0.7 })[0], antes }, { t: '', f: selo.f, peso: 900, selo, antes });   // não coube ao lado: o TOPO desce
    return L;
  };
  desenharLinhas(k, escolherTamanho(k, [[[s => montar(s, false)], 0.75], [[montar], 0.6]], H - M * 0.8) || montar(0.6), M * 0.45);   // nome inteiro, se der
}
/** Tamanho da etiqueta em pontos para a impressora conectada (ou 203 dpi, para a prévia). */
function medidasEtiqueta(meta) {
  const [wMm, hMm] = confNiimbot().tamanho.split('x').map(Number), dpi = meta?.dpi || 203, pxmm = dpi / 25.4;
  let W = Math.round(wMm * pxmm), H = Math.round(hMm * pxmm);
  // a cabeça de impressão limita a largura (B1: 48 mm) ou, nas D11/D110 (imprimem de lado), a altura
  if (meta?.printheadPixels) { if ((meta.printDirection || 'top') === 'top') W = Math.min(W, meta.printheadPixels); else H = Math.min(H, meta.printheadPixels); }
  return { W, H, pxmm };
}
/** Manda as etiquetas para a Niimbot num trabalho só. aoAvancar(feitas, total); parar(): true interrompe. */
async function imprimirNaNiimbot(etiquetas, { aoAvancar, parar } = {}) {
  const { lib, client } = niim;
  const meta = client.getModelMetadata() || {};
  const { W, H, pxmm } = medidasEtiqueta(meta), loja = await configLoja() || {};
  const direcao = meta.printDirection || 'top';
  const tarefa = client.getPrintTaskType() || (direcao === 'left' ? 'D110' : 'B1');
  const task = client.protocol.newPrintTask(tarefa, {
    totalPages: etiquetas.length, density: meta.densityDefault || 3, labelType: lib.LabelType.WithGaps, statusPollIntervalMs: 100, statusTimeoutMs: 8000
  });
  let feitas = 0;
  try {
    await task.printInit();
    for (const et of etiquetas) {
      if (parar?.()) break;
      await task.printPage(lib.ImageEncoder.encodeCanvas(canvasEtiqueta(et, W, H, pxmm, loja), lib.PageColorType.SingleColor, direcao), 1);
      await task.waitForPageFinished();
      feitas++;
      aoAvancar?.(feitas, etiquetas.length);
    }
    if (feitas === etiquetas.length) await task.waitForFinished();
  } finally {
    await task.printEnd().catch(() => {});
  }
  return feitas;
}
/** Traduz o erro da impressora para a equipe. */
const erroNiimbot = e => new Error(/print|paper|lid|cover/i.test(e?.message || '') ? `A Niimbot não imprimiu (${e.message}). Confira se a tampa está fechada e se tem etiqueta.` : e?.message || String(e));
/**
 * Etiquetas na Niimbot, uma impressão de cada vez. Num toque (botão Etiqueta, Testar, lote), conecta se precisar.
 * Na impressão automática não dá para abrir a lista do Bluetooth sem um toque: avisa com o botão para conectar.
 */
function etiquetasNiimbot(etiquetas, { automatico = false, rotulo = 'Etiqueta', aoAvancar, parar } = {}) {
  const tarefa = filaNiimbot.then(async () => {
    if (!niimbotConectada()) {
      if (automatico) {
        toast(`${rotulo} não saiu: a Niimbot está desconectada.`, { tipo: 'erro', tempo: 20000,
          acao: { rotulo: 'Conectar e imprimir', fn: () => etiquetasNiimbot(etiquetas, { rotulo }).catch(erroToast) } });
        return 0;
      }
      await conectarNiimbot();
    }
    const feitas = await imprimirNaNiimbot(etiquetas, { aoAvancar, parar });
    if (feitas) toast(`${rotulo} impressa${feitas > 1 ? `s (${feitas} etiquetas)` : ''} na Niimbot.`);
    return feitas;
  });
  filaNiimbot = tarefa.catch(() => {});
  return tarefa.catch(e => { throw erroNiimbot(e); });
}
async function etiquetaNiimbot(p, opcoes = {}) {
  await mapaKitsLoja();   // o que vem em cada kit (para achar bolo e topo dentro dele)
  return etiquetasNiimbot(etiquetasDoPedido(p), { rotulo: `Etiqueta do pedido ${p.codigo}`, ...opcoes });
}
/** Várias etiquetas na térmica de 80 mm (sem Niimbot): o mesmo desenho, uma por página. */
async function imprimirEtiquetasTermica(etiquetas) {
  const [wMm, hMm] = confNiimbot().tamanho.split('x').map(Number), pxmm = 8, W = 72 * pxmm, H = Math.round(W * hMm / wMm);
  const loja = await configLoja() || {};
  const imgs = etiquetas.map(et => `<img src="${canvasEtiqueta(et, W, H, pxmm, loja).toDataURL('image/png')}" alt="">`).join('');
  return mandarParaTermica(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas</title><style>
    @page { size: 80mm auto; margin: 0; } * { margin: 0; padding: 0; } body { width: 80mm; padding: 2mm 4mm; background: #fff; }
    img { display: block; width: 72mm; break-after: page; page-break-after: always; image-rendering: pixelated; }
  </style></head><body>${imgs}</body></html>`);
}
/** Botão "Etiqueta": na Niimbot, se estiver em uso neste aparelho; senão, na térmica de 80 mm. */
const imprimirEtiquetaDoPedido = (p, opcoes) => (confNiimbot().usar ? etiquetaNiimbot(p, opcoes) : imprimirEtiqueta(p));
/** Linhas da lista de pedidos (vw_pedidos) com os itens de cada uma, numa consulta só. */
async function pedidosComItens(linhas) {
  const ids = linhas.map(p => p.id), porPedido = new Map(ids.map(id => [id, []]));
  for (let i = 0; i < ids.length; i += 100) {
    const itens = await api.admin.pedidos.itens.listar({ filtros: { pedido_id: ids.slice(i, i + 100) }, ordenarPor: [['pedido_id', true], ['ordem', true]] });
    itens.forEach(it => porPedido.get(it.pedido_id)?.push(it));
  }
  return linhas.map(p => ({ ...p, itens: porPedido.get(p.id) || [] }));
}

/* ---- Imprimir vários pedidos de uma vez (Pedidos e Hoje): o cupom de 80 mm ou as etiquetas ---- */
const OPCOES_LOTE = [
  ['completo', 'Pedido completo · 80 mm', 'um por pedido, igual ao botão Imprimir 80 mm'],
  ['producao', 'Etiqueta de produção', 'uma por bolo: cliente, horário, recheio, massa, formato e topo'],
  ['pedido', 'Etiqueta do pedido', 'uma por pedido: código, cliente, itens e pagamento']
];
const CHAVE_LOTE = 'ritabolos.lote';
/** O que saiu da última vez neste aparelho; na primeira, o cupom de 80 mm (ou a etiqueta, se a Niimbot estiver em uso aqui). */
function tipoLote() {
  try { const t = localStorage.getItem(CHAVE_LOTE); if (OPCOES_LOTE.some(([v]) => v === t)) return t; } catch (e) { /* sem armazenamento */ }
  return confNiimbot().usar ? (confNiimbot().conteudo || 'producao') : 'completo';
}
/** Os pedidos completos, como na gaveta (com as anotações fixadas), alguns de cada vez e na ordem pedida. */
async function pedidosCompletos(ids, aoAvancar) {
  const out = [];
  for (let i = 0; i < ids.length; i += 6) {
    out.push(...await Promise.all(ids.slice(i, i + 6).map(id => api.admin.pedidos.obter(id))));
    aoAvancar?.(Math.min(ids.length, i + 6), ids.length);
  }
  return out.filter(Boolean);
}
async function modalImprimirLote(linhas, titulo = 'Imprimir pedidos') {
  if (!linhas.length) { toast('Não há pedidos nesta lista para imprimir.'); return; }
  let pedidos;
  try { [pedidos] = await Promise.all([pedidosComItens(linhas), mapaKitsLoja()]); } catch (e) { erroToast(e); return; }
  pedidos.sort((a, b) => String(a.data_retirada).localeCompare(String(b.data_retirada)) || String(a.hora_retirada || '99').localeCompare(String(b.hora_retirada || '99')) || a.cliente_nome.localeCompare(b.cliente_nome));
  let tipo = tipoLote(), parar = false, imprimindo = false;
  const naNiimbot = confNiimbot().usar;
  const marcados = new Set(pedidos.filter(p => !p.finalizado && p.status !== 'cancelado').map(p => p.id));   // retirados e cancelados começam desmarcados
  const variosDias = new Set(pedidos.map(p => p.data_retirada)).size > 1;
  const m = abrirModal({
    titulo, largo: true,
    corpo: `<div class="lote-conteudo" role="radiogroup" aria-label="O que imprimir">${OPCOES_LOTE.map(([v, t, d]) => `<label class="est-tipo"><input type="radio" name="loteCont" value="${v}" ${v === tipo ? 'checked' : ''}><span><b>${esc(t)}</b><small>${esc(d)}</small></span></label>`).join('')}</div>
      <div class="lote-barra"><button type="button" class="link" data-lote-todos>Marcar todos</button><button type="button" class="link" data-lote-nenhum>Desmarcar todos</button><span id="loteConta"></span></div>
      <div class="lote-lista" id="loteLista">${pedidos.map(p => `<label class="lote-it ${p.status === 'cancelado' ? 'cancelado' : ''}"><input type="checkbox" data-lote="${esc(p.id)}" ${marcados.has(p.id) ? 'checked' : ''}>
        <span class="lote-q">${variosDias ? `<small>${esc(dataCurta(p.data_retirada))}</small>` : ''}${p.hora_retirada ? esc(hora(p.hora_retirada)) : '—'}</span>
        <span class="lote-n"><b>${esc(p.cliente_nome)}</b><small>${esc(p.codigo)} · ${esc(p.status_nome || p.status)}</small></span>
        <em data-lote-n="${esc(p.id)}"></em></label>`).join('')}</div>
      <div data-so-etiqueta><p class="secao-t">Prévia da primeira etiqueta</p><div class="nb-previa" id="lotePrevia"></div>
        ${naNiimbot ? '' : '<p class="ajuste-dica" style="margin:8px 0 0">Sem a Niimbot ligada neste aparelho (Minha conta), as etiquetas saem na térmica de 80 mm, uma por página.</p>'}</div>
      <p class="ajuste-dica" data-so-cupom style="margin:12px 0 0">Sai o cupom de cada pedido, igual ao do botão Imprimir 80 mm, na ordem da lista e numa impressão só. Cada pedido começa numa página nova: se a térmica estiver configurada para cortar a cada página, ela corta entre um e outro.</p>
      <div class="lote-prog" id="loteProg" hidden><div class="lote-trilho"><i></i></div><span aria-live="polite"></span></div>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Fechar</button><button type="button" class="btn primary" data-ok>${ic('imprimir')}<span>Imprimir</span></button>`
  });
  const ehCupom = () => tipo === 'completo';
  const selecionados = () => pedidos.filter(p => marcados.has(p.id));
  const etiquetas = () => (ehCupom() ? [] : selecionados().flatMap(p => etiquetasDoPedido(p, tipo)));
  const atualizar = () => {
    const cupom = ehCupom();
    m.$('[data-so-etiqueta]').hidden = cupom; m.$('[data-so-cupom]').hidden = !cupom;
    pedidos.forEach(p => {
      const em = m.$(`[data-lote-n="${CSS.escape(p.id)}"]`); if (!em) return;
      if (cupom) { const n = p.itens.length; em.textContent = `${n} ${n === 1 ? 'item' : 'itens'}`; return; }
      const n = etiquetasDoPedido(p, tipo).length, bolo = tipo !== 'pedido' && p.itens.some(ehBoloProducao);
      em.textContent = tipo === 'pedido' ? '1 etiqueta' : bolo ? `${n} ${n === 1 ? 'bolo' : 'bolos'}` : 'sem bolo: 1 do pedido';
    });
    const sel = marcados.size, n = cupom ? sel : etiquetas().length;
    const marc = `${sel} ${sel === 1 ? 'pedido marcado' : 'pedidos marcados'}`, unid = n === 1 ? 'etiqueta' : 'etiquetas';
    m.$('#loteConta').textContent = cupom ? marc : `${marc} · ${n} ${unid}`;
    const bt = m.$('[data-ok]'); bt.disabled = !n || imprimindo;
    bt.querySelector('span').textContent = imprimindo ? 'Imprimindo…'
      : cupom ? `Imprimir ${n} ${n === 1 ? 'pedido' : 'pedidos'} em 80 mm` : `Imprimir ${n} ${unid}${naNiimbot ? ' na Niimbot' : ''}`;
    if (cupom) return;
    const prim = etiquetas()[0], box = m.$('#lotePrevia');
    if (!prim) { box.textContent = 'Marque pelo menos um pedido.'; return; }
    const { W, H, pxmm } = medidasEtiqueta(niimbotConectada() ? niim.client.getModelMetadata() : null);
    const c = canvasEtiqueta(prim, W, H, pxmm, cacheLoja || {});
    c.style.width = `${Math.min(280, Number(confNiimbot().tamanho.split('x')[0]) * 5.2)}px`; c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Prévia da primeira etiqueta');
    box.replaceChildren(c);
  };
  m.el.addEventListener('change', e => {
    if (e.target.name === 'loteCont') {
      tipo = e.target.value;
      try { localStorage.setItem(CHAVE_LOTE, tipo); } catch (err) { /* só nesta visita */ }
      if (!ehCupom()) salvarConfNiimbot({ conteudo: tipo });   // a etiqueta escolhida vale também para o botão Etiqueta
    }
    if (e.target.dataset.lote) { if (e.target.checked) marcados.add(e.target.dataset.lote); else marcados.delete(e.target.dataset.lote); }
    atualizar();
  });
  m.$('[data-lote-todos]').addEventListener('click', () => { pedidos.forEach(p => marcados.add(p.id)); m.$$('[data-lote]').forEach(c => { c.checked = true; }); atualizar(); });
  m.$('[data-lote-nenhum]').addEventListener('click', () => { marcados.clear(); m.$$('[data-lote]').forEach(c => { c.checked = false; }); atualizar(); });
  atualizar();
  const prog = m.$('#loteProg'), barra = prog.querySelector('i'), txt = prog.querySelector('span');
  const avancar = (feitas, total) => { barra.style.width = `${Math.round(feitas / total * 100)}%`; txt.textContent = `Impressa${feitas === 1 ? '' : 's'} ${feitas} de ${total}`; };
  // a impressão leva o foco para o quadro escondido da térmica: volta para a janela (o Esc fecha de novo)
  const voltarFoco = () => { if (m.el.isConnected) m.$('.modal-f [data-fechar]')?.focus(); };
  // cupom de 80 mm: busca os pedidos completos (com as anotações) e manda tudo numa impressão só
  const imprimirCupomLote = async () => {
    const ids = selecionados().map(p => p.id); if (!ids.length) return;
    imprimindo = true; atualizar();
    prog.hidden = false; barra.style.width = '0%'; txt.textContent = `Preparando ${ids.length} ${ids.length === 1 ? 'pedido' : 'pedidos'}…`;
    try {
      const completos = await pedidosCompletos(ids, (f, t) => { barra.style.width = `${Math.round(f / t * 90)}%`; });
      await imprimirCupons(completos);
      barra.style.width = '100%';
      txt.textContent = `Enviado${completos.length === 1 ? '' : 's'} ${completos.length} ${completos.length === 1 ? 'pedido' : 'pedidos'} para a térmica.`;
    } catch (e) { erroToast(e); txt.textContent = e.message || 'Não deu para imprimir.'; }
    finally { imprimindo = false; atualizar(); voltarFoco(); }
  };
  m.$('[data-ok]').addEventListener('click', async () => {
    if (imprimindo) return;
    if (ehCupom()) { await imprimirCupomLote(); return; }
    const lista = etiquetas(); if (!lista.length) return;
    imprimindo = true; parar = false; atualizar();
    prog.hidden = false; avancar(0, lista.length); txt.textContent = `Enviando ${lista.length} ${lista.length === 1 ? 'etiqueta' : 'etiquetas'}…`;
    const fechar = m.$('.modal-f [data-fechar]'); fechar.textContent = 'Parar';
    const pararClique = ev => { if (imprimindo) { ev.stopPropagation(); parar = true; txt.textContent = 'Parando depois da etiqueta atual…'; } };
    fechar.addEventListener('click', pararClique, true);
    try {
      if (naNiimbot) {
        const feitas = await etiquetasNiimbot(lista, { rotulo: 'Etiquetas', aoAvancar: avancar, parar: () => parar });
        txt.textContent = parar ? `Parou: ${feitas} de ${lista.length} impressas.` : `Pronto: ${feitas} ${feitas === 1 ? 'etiqueta impressa' : 'etiquetas impressas'}.`;
      } else {
        await imprimirEtiquetasTermica(lista);
        txt.textContent = `Enviadas ${lista.length} etiquetas para a térmica.`; avancar(lista.length, lista.length);
      }
    } catch (e) { erroToast(e); txt.textContent = e.message || 'Não deu para imprimir.'; }
    finally {
      imprimindo = false; fechar.removeEventListener('click', pararClique, true); fechar.textContent = 'Fechar'; atualizar(); voltarFoco();
    }
  });
}

/* ---- Impressão automática: cada pedido que vira "Confirmado" sai na térmica deste aparelho ----
   Fica ligada só no computador da impressora (Minha conta). Sem a janela de impressão, só com o
   Chrome aberto com --kiosk-printing (imprime direto na impressora padrão). */
const CHAVE_AUTO_IMP = 'ritabolos.impressao-auto';
function impressaoAuto() {
  try { return JSON.parse(localStorage.getItem(CHAVE_AUTO_IMP) || 'null') || { ligada: false, formato: 'etiqueta' }; } catch (e) { return { ligada: false, formato: 'etiqueta' }; }
}
function salvarImpressaoAuto(c) { try { localStorage.setItem(CHAVE_AUTO_IMP, JSON.stringify(c)); } catch (e) { /* sem armazenamento */ } }
/** Pedidos já impressos aqui (não imprime de novo quando o pedido muda por outro motivo). */
function jaImpresso(id, marcar) {
  let l = [];
  try { l = JSON.parse(localStorage.getItem(CHAVE_AUTO_IMP + '.feitos') || '[]'); } catch (e) { l = []; }
  if (!marcar) return l.includes(id);
  try { localStorage.setItem(CHAVE_AUTO_IMP + '.feitos', JSON.stringify([...l.filter(x => x !== id), id].slice(-300))); } catch (e) { /* idem */ }
  return true;
}
async function imprimirSeConfirmado(pedido) {
  const cfg = impressaoAuto();
  if (!cfg.ligada || ehProdutor() || pedido?.status !== 'confirmado' || !pedido.id) return;
  const naNiimbot = cfg.formato !== 'pedido' && confNiimbot().usar;
  // etiqueta na Niimbot com várias abas abertas: a aba que está conectada imprime primeiro
  if (naNiimbot && !niimbotConectada()) await new Promise(r => setTimeout(r, 2500));
  // várias abas abertas neste computador: só uma imprime
  const fazer = async () => {
    if (jaImpresso(pedido.id)) return;
    const p = await api.admin.pedidos.obter(pedido.id).catch(() => null);
    if (!p || p.status !== 'confirmado') return;
    // só o que acabou de ser confirmado (não reimprime pedido antigo que só teve outra alteração)
    const conf = [...(p.historico || [])].reverse().find(h => h.status_novo === 'confirmado');
    if (!conf || Date.now() - new Date(conf.alterado_em).getTime() > 10 * 60e3) return;
    jaImpresso(p.id, true);
    if (naNiimbot) { await etiquetaNiimbot(p, { automatico: true }); return; }
    toast(`Imprimindo ${cfg.formato === 'pedido' ? 'o pedido' : 'a etiqueta do pedido'} ${p.codigo}…`);
    await (cfg.formato === 'pedido' ? imprimirTermica(p) : imprimirEtiqueta(p));
  };
  if (navigator.locks?.request) await navigator.locks.request('ritabolos-impressao-auto', fazer);
  else await fazer();
}

function renderGaveta(p) {
  pedidoAtual = p;
  // conteúdo dos kits: na primeira vez ainda não carregou; quando chegar, redesenha
  if (!kitsCache) mapaKitsLoja().then(() => { if (pedidoAtual?.id === p.id && $('#gaveta')?.classList.contains('on')) renderGaveta(pedidoAtual); });
  const g = $('#gaveta');
  const rolagem = g.querySelector('.gav-b')?.scrollTop || 0;
  const prox = proximoStatus(p);
  const itens = p.itens.map(i => `<div class="it">
      <div class="it-l"><span>${i.quantidade}× ${esc(i.nome)}${i.peso_kg ? ` <span style="color:var(--teal)">${esc(formatarPeso(i.peso_kg))}</span>` : ''}</span><span>${R(i.subtotal)}</span></div>
      ${i.massa || i.formato ? `<div class="it-d">${i.massa ? `<b>Massa:</b> ${esc(i.massa)}` : ''}${i.massa && i.formato ? ' · ' : ''}${i.formato ? `<b>Formato:</b> ${esc(i.formato)}` : ''}</div>` : ''}
      ${i.segundo_recheio ? `<div class="it-d"><b>2º recheio:</b> ${esc(i.segundo_recheio)}</div>` : ''}
      ${kitDoItem(i) ? `<div class="it-d it-kit"><b>Vem no kit:</b> ${esc(kitDoItem(i))}</div>` : ''}
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
        <button type="button" class="btn sm" data-gav="etiqueta">${ic('imprimir')}Etiqueta</button>
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
  if (isAdmin()) toposDaGaveta(p);
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
    case 'etiqueta': ocupado(b, () => imprimirEtiquetaDoPedido(p)); break;
    case 'topo': { const i = p.itens.find(x => String(x.id) === b.dataset.item); if (i) modalTopo(p, i); break; }
    case 'topo-novo': { const i = p.itens.find(x => String(x.id) === b.dataset.item); if (i) novoTopoDoItem(p, i); break; }
    case 'topo-ver': abrirTopo(b.dataset.id, () => toposDaGaveta(pedidoAtual)); break;
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
  const msg = montarMensagemStatus(p, status, await urlReciboCliente(p), await configLoja());
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
function modelosMensagem(p, urlRecibo, pix) {
  const nome = String(p.cliente_nome || '').trim().split(/\s+/)[0] || '';
  const comPix = pix ? `\n\n${textoPix(pix)}` : '';
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
    faltaSinal > 0 && !st.finalizado && { id: 'sinal', rot: 'Lembrar do sinal', txt: `${ola}\n\nPara confirmar o seu pedido ${ped}, falta o sinal de *${v(faltaSinal)}*. Pode mandar o comprovante por aqui mesmo.${comPix}\n\nAgradecemos!` },
    !st.finalizado && { id: 'retirada', rot: 'Lembrar da retirada', txt: `${ola}\n\nPassando para lembrar: a retirada do seu pedido ${ped} é ${quando}.\n\n${itens}${saldo > 0 ? `\n\nNa retirada, falta pagar *${v(saldo)}*.` : ''}` },
    !st.finalizado && { id: 'pronto', rot: 'Pedido pronto', txt: `${ola}\n\nSeu pedido ${ped} está *pronto para retirada*!${p.hora_retirada || d ? ` Combinamos ${quando}.` : ''}${saldo > 0 ? `\n\nFalta pagar *${v(saldo)}*: pode ser na retirada.` : '\n\nEstá tudo pago, é só vir buscar.'}` },
    saldo > 0 && faltaSinal <= 0 && { id: 'saldo', rot: 'Saldo a pagar', txt: `${ola}\n\nO restante do seu pedido ${ped} é *${v(saldo)}*. Pode pagar na retirada ou mandar o comprovante por aqui.${comPix}` },
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
  const { modelos, sugerido } = modelosMensagem(p, await urlReciboCliente(p).catch(() => ''), pixDe(await configLoja()));
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
  if (!cardapioAtivo || forcar) {
    cardapioAtivo = await api.cardapio.obter();
    // pesos do menor para o maior: o banco manda na ordem de cadastro (o 1 kg cadastrado depois ia para o fim)
    if (Array.isArray(cardapioAtivo?.bolo?.pesos)) cardapioAtivo.bolo.pesos = cardapioAtivo.bolo.pesos.map(Number).sort((a, b) => a - b);
  }
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
  cardapioAtivo = null; kitsCache = null;
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
      cardapioAtivo = null; kitsCache = null;
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
      try { await tabela.atualizar(attr === 'peso' ? Number(id) : id, { ativo: e.target.checked }); e.target.closest('.r').classList.toggle('off', !e.target.checked); cardapioAtivo = null; kitsCache = null; }
      catch (err) { erroToast(err); e.target.checked = !e.target.checked; }
      return;
    }
  };
}

/* ---- Loja ---- */
const PASSOS_RETIRADA = [[15, '15 minutos'], [20, '20 minutos'], [30, '30 minutos'], [45, '45 minutos'], [60, '1 hora']];
const hm5 = v => /^\d\d:\d\d/.test(v || '') ? String(v).slice(0, 5) : '';
/** Horários que o site oferece na retirada, como o cliente vê (index.html, campoRetirada). */
function horariosRetirada(ini, fim, passo) {
  const min = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const hs = [];
  for (let m = min(ini); passo > 0 && m <= min(fim); m += passo) hs.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  return hs;
}
/* Chave Pix conferida antes de salvar: um número trocado mandaria o sinal para outra pessoa */
function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); return (s * 10) % 11 % 10; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}
/** CNPJ com dígito verificador; aceita o formato novo da Receita, com letras nas 12 primeiras posições. */
function cnpjValido(d) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(.)\1{13}$/.test(d)) return false;
  const v = ch => ch.charCodeAt(0) - 48, pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += v(d[i]) * pesos[i + 13 - n]; return s % 11 < 2 ? 0 : 11 - s % 11; };
  return dv(12) === v(d[12]) && dv(13) === v(d[13]);
}
/** A chave no formato de cada tipo (CPF só números, celular com +55...), ou erro. */
function chavePix(tipo, chave) {
  if (tipo === 'CPF') { const d = chave.replace(/\D/g, ''); if (!cpfValido(d)) throw new Error('Confira a chave Pix: esse CPF não é válido.'); return d; }
  if (tipo === 'CNPJ') { const d = chave.toUpperCase().replace(/[^0-9A-Z]/g, ''); if (!cnpjValido(d)) throw new Error('Confira a chave Pix: esse CNPJ não é válido.'); return d; }
  if (tipo === 'Celular') { const d = digitosTel(chave); if (d.length !== 10 && d.length !== 11) throw new Error('Informe o celular da chave Pix com DDD.'); return '+55' + d; }
  if (tipo === 'E-mail') { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave)) throw new Error('Confira o e-mail da chave Pix.'); return chave.toLowerCase(); }
  if (tipo === 'Chave aleatória') {
    const h = chave.toLowerCase().replace(/[\s-]/g, '');
    if (!/^[0-9a-f]{32}$/.test(h)) throw new Error('A chave aleatória tem 32 letras e números, como aparece no app do banco.');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return chave;
}
/** Pix e horários de retirada do formulário, já conferidos (sql/ajustes-loja.sql). */
function ajustesPixRetirada(f) {
  const falha = (id, msg) => { const el = f.$('#' + id); el?.setAttribute('aria-invalid', 'true'); el?.focus(); throw new Error(msg); };
  ['lPixChave', 'lRetIni', 'lRetFim', 'lRetDias'].forEach(id => f.$('#' + id)?.removeAttribute('aria-invalid'));
  const tipo = valDe(f, 'lPixTipo'), chave = valDe(f, 'lPixChave');
  let pixChave = null;
  if (chave) { try { pixChave = chavePix(tipo, chave); } catch (e) { falha('lPixChave', e.message); } }
  const ini = valDe(f, 'lRetIni'), fim = valDe(f, 'lRetFim'), dias = numDe(f, 'lRetDias');
  if (!ini) falha('lRetIni', 'Informe o primeiro horário de retirada.');
  if (!fim || fim <= ini) falha('lRetFim', 'O último horário de retirada precisa ser depois do primeiro.');
  if (!(dias >= 1 && dias <= 60)) falha('lRetDias', 'Os dias para escolher no site precisam ficar entre 1 e 60.');
  return { pix_chave: pixChave, pix_tipo: tipo || null, pix_nome: valDe(f, 'lPixNome') || null,
    retirada_inicio: ini, retirada_fim: fim, retirada_intervalo_min: Number(valDe(f, 'lRetPasso')) || 30, retirada_dias: Math.round(dias) };
}
async function ajLoja(box) {
  let c;
  const topos = await contatoTopos();
  try { c = await configLoja(true); if (!c) throw new Error('Configurações não encontradas. Rode o seed.sql.'); } catch (e) { box.innerHTML = `<div class="vazio"><h2>Não foi possível carregar</h2><p>${esc(e.message)}</p></div>`; return; }
  // Pix e horários de retirada: campos do sql/ajustes-loja.sql (antes ficavam escritos no código)
  const temAjustes = 'pix_chave' in c && 'retirada_inicio' in c, so = temAjustes ? '' : 'disabled';
  const pix = temAjustes ? { chave: c.pix_chave || '', tipo: c.pix_tipo || 'CPF', nome: c.pix_nome || '' } : pixDe({});
  const ret = { ini: hm5(c.retirada_inicio) || '08:00', fim: hm5(c.retirada_fim) || '18:00', passo: Number(c.retirada_intervalo_min) || 30, dias: Number(c.retirada_dias) || 14 };
  const passos = PASSOS_RETIRADA.some(([v]) => v === ret.passo) ? PASSOS_RETIRADA : [...PASSOS_RETIRADA, [ret.passo, `${ret.passo} minutos`]].sort((a, b) => a[0] - b[0]);
  const tipos = [...new Set([...TIPOS_PIX, pix.tipo].filter(Boolean))].map(t => [t, t]);
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
      ${inTxt('lUrl', 'Endereço do site', c.url_site || '', { attrs: 'type="url" placeholder="https://ritabolos.com.br/"', dica: 'Usado no link do recibo que vai no WhatsApp.' })}
      ${fotoCampo('lLogo', 'Logotipo', c.logo_path)}

      <p class="secao-t linha">Pedidos e sinal</p>
      <div class="grid3">${inNum('lSinal', 'Sinal (%)', c.percentual_sinal, { attrs: 'min="0" max="100" step="1"' })}${inNum('lAnt', 'Antecedência mínima (dias)', c.antecedencia_minima_dias, { attrs: 'min="0"' })}${inNum('lTol', 'Tolerância de peso do bolo (g)', c.tolerancia_peso_bolo_g, { attrs: 'min="0" step="50"' })}</div>

      <p class="secao-t linha">Pix do sinal</p>
      ${temAjustes ? '' : '<div class="aviso-box">Rode no Supabase o arquivo <code>sql/ajustes-loja.sql</code> para mudar o Pix e os horários de retirada por aqui. Até lá, valem os de sempre (mostrados abaixo).</div>'}
      <div class="grid3">${inSel('lPixTipo', 'Tipo da chave', tipos, pix.tipo, { attrs: so })}${inTxt('lPixChave', 'Chave Pix', pix.chave, { attrs: `maxlength="80" autocomplete="off" spellcheck="false" ${so}` })}${inTxt('lPixNome', 'Nome de quem recebe', pix.nome, { attrs: `maxlength="80" ${so}` })}</div>
      <p class="ajuste-dica">Aparece no fim do pedido no site, nas mensagens do WhatsApp, no recibo e na impressão. Com a chave em branco, o Pix não aparece.</p>

      <p class="secao-t linha">Retirada</p>
      <div class="grid2">${campo('lRetIni', 'Primeiro horário no site', `<input class="in" id="lRetIni" type="time" value="${ret.ini}" ${so}>`)}${campo('lRetFim', 'Último horário no site', `<input class="in" id="lRetFim" type="time" value="${ret.fim}" ${so}>`)}</div>
      <div class="grid2">${inSel('lRetPasso', 'Intervalo entre os horários', passos, ret.passo, { attrs: so })}${inNum('lRetDias', 'Dias para escolher no site', ret.dias, { attrs: `min="1" max="60" ${so}` })}</div>
      <p class="ajuste-dica" id="lRetPrev" aria-live="polite"></p>
      <div class="grid2">${inNum('lDias', 'Retirada sugerida (dias depois do pedido)', c.dias_retirada_sugerida, { attrs: 'min="0"', dica: 'Só para pedidos lançados aqui pela equipe. No site, o cliente escolhe o dia.' })}${campo('lHora', 'Horário sugerido', `<input class="in" id="lHora" type="time" value="${esc(hora(c.hora_retirada_sugerida))}">`, 'Idem: no site, o cliente escolhe o horário.')}</div>

      <p class="secao-t linha">Topos de bolo</p>
      <div class="grid2">${inTxt('lTopNum', 'WhatsApp de quem faz os topos', formatarTel(topos.numero), { attrs: ATTR_TEL, dica: 'Usado no botão “Enviar para quem faz o topo”, ao lado da imagem de referência.' })}${inTxt('lTopNome', 'Nome de quem faz os topos', topos.nome, { attrs: 'maxlength="60"' })}</div>
      <div style="display:flex;justify-content:flex-end"><button type="button" class="btn primary" id="lSalvar">Salvar ajustes</button></div>
    </div>`;
  const fake = { $: s => box.querySelector(s), $$: s => [...box.querySelectorAll(s)] };
  ligarFotos(fake, 'marca');
  // prévia dos horários que o cliente vai ver
  const previaRetirada = () => {
    const ini = valDe(fake, 'lRetIni'), fim = valDe(fake, 'lRetFim'), dias = numDe(fake, 'lRetDias'), el = box.querySelector('#lRetPrev');
    if (!ini || !fim || fim <= ini) { el.textContent = 'O último horário precisa ser depois do primeiro.'; return; }
    const hs = horariosRetirada(ini, fim, Number(valDe(fake, 'lRetPasso')));
    el.textContent = `No site aparecem ${hs.length} ${hs.length === 1 ? 'horário' : 'horários'} (${hs.length > 6 ? `${hs.slice(0, 3).join(', ')} … ${hs.at(-1)}` : hs.join(', ')})`
      + `${dias >= 1 ? `, nos próximos ${dias} ${dias === 1 ? 'dia' : 'dias'}` : ''}. O cliente ainda pode digitar outro horário.`;
  };
  previaRetirada();
  box.oninput = e => { if (/^lRet/.test(e.target.id)) previaRetirada(); };
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
    const pixRetirada = temAjustes ? ajustesPixRetirada(fake) : {};
    await api.admin.configuracoes.salvar({
      mensagem_pausa: valDe(fake, 'lPausa') || null, nome_loja: valDe(fake, 'lNome'), slogan: valDe(fake, 'lSlogan') || null,
      whatsapp_numero: wa, whatsapp_exibicao: valDe(fake, 'lWaEx') || formatarTel(waDig), percentual_sinal: sinal,
      antecedencia_minima_dias: numDe(fake, 'lAnt') || 0, tolerancia_peso_bolo_g: numDe(fake, 'lTol') || 0,
      dias_retirada_sugerida: numDe(fake, 'lDias') || 0, hora_retirada_sugerida: valDe(fake, 'lHora') || '10:00',
      url_site: valDe(fake, 'lUrl') || null, logo_path: fotoDe(fake, 'lLogo'), ...pixRetirada
    });
    if (temAjustes) fake.$('#lPixChave').value = pixRetirada.pix_chave || '';   // como ficou gravada (CPF só com números etc.)
    const topNum = digitosTel(valDe(fake, 'lTopNum'));
    if (topNum && topNum.length < 10) throw new Error('Informe o WhatsApp de quem faz os topos com DDD.');
    await salvarContatoTopos(topNum, valDe(fake, 'lTopNome'));
    cacheLoja = null; cardapioAtivo = null; kitsCache = null; toast('Ajustes salvos. O site já mostra as mudanças.');
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
      <p class="secao-t linha">Vários de uma vez (bolos grandes)</p>
      <form id="fPesos" class="pesos-faixa">
        <div class="field"><label for="pesoDe">De (kg)</label><input class="in" id="pesoDe" inputmode="decimal" placeholder="6"></div>
        <div class="field"><label for="pesoAte">Até (kg)</label><input class="in" id="pesoAte" inputmode="decimal" placeholder="20"></div>
        <div class="field"><label for="pesoPasso">A cada</label><select class="sel" id="pesoPasso"><option value="1">1 kg</option><option value="0.5">0,5 kg</option><option value="2">2 kg</option></select></div>
        <button type="submit" class="btn">${ic('mais')}Adicionar</button></form>
      <p class="ajuste-dica" style="margin:8px 0 0">Ex.: de 6 a 20 kg, a cada 1 kg. Os que já existem ficam como estão. No site, quando há mais de três pesos acima de 5 kg, eles aparecem juntos no botão “+ de 5 kg”.</p>
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
      toast(`${formatarPeso(v)} adicionado.`); cardapioAtivo = null; kitsCache = null; ajBolos(box);
    });
  });
  // vários pesos numa faixa (ex.: de 6 a 20 kg, a cada 1 kg): cria só os que ainda não existem
  box.querySelector('#fPesos').addEventListener('submit', e => {
    e.preventDefault();
    ocupado(e.submitter, async () => {
      const de = lerValor(box.querySelector('#pesoDe').value), ate = lerValor(box.querySelector('#pesoAte').value), passo = Number(box.querySelector('#pesoPasso').value);
      if (!(de > 0 && ate >= de && ate < 100)) throw new Error('Informe de quantos até quantos kg, por exemplo de 6 a 20.');
      const faixa = [];
      for (let v = de; v <= ate + 1e-9; v += passo) faixa.push(Math.round(v * 100) / 100);
      if (faixa.length > 60) throw new Error(`Seriam ${faixa.length} pesos de uma vez. Use uma faixa menor (até 60).`);
      const novos = faixa.filter(v => !pesos.some(p => Number(p.peso_kg) === v));
      if (!novos.length) throw new Error('Esses pesos já existem.');
      for (const v of novos) await api.admin.pesosBolo.criar({ peso_kg: v, ordem: Math.round(v * 10), ativo: true });
      toast(`${novos.length} ${novos.length === 1 ? 'peso adicionado' : 'pesos adicionados'}: de ${formatarPeso(novos[0])} a ${formatarPeso(novos[novos.length - 1])}.`);
      cardapioAtivo = null; kitsCache = null; ajBolos(box);
    });
  });
  box.onclick = async e => {
    const tp = e.target.closest('[data-tirar-peso]');
    if (tp) {
      if (!await confirmar(`Excluir ${formatarPeso(tp.dataset.tirarPeso)}?`, 'Esse peso deixa de aparecer na escolha do bolo.', { botao: 'Excluir', perigo: true })) return;
      await ocupado(tp, async () => { await api.admin.pesosBolo.remover(Number(tp.dataset.tirarPeso)); cardapioAtivo = null; kitsCache = null; ajBolos(box); });
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
        await ocupado(m.$('[data-del]'), async () => { await api.admin.formatosBolo.remover(x.id); m.fechar(); cardapioAtivo = null; kitsCache = null; ajBolos(box); });
      });
      m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
        exigir(m, 'fNome', 'Informe o nome do formato.');
        const dados = { nome: valDe(m, 'fNome'), descricao: valDe(m, 'fDesc') || null, ordem: numDe(m, 'fOrd') || 0, slug: slugify(valDe(m, 'fSlug') || valDe(m, 'fNome')), ativo: chkDe(m, 'fAtivo') };
        if (novo) await api.admin.formatosBolo.criar(dados); else await api.admin.formatosBolo.atualizar(x.id, dados);
        m.fechar(); toast('Formato salvo.'); cardapioAtivo = null; kitsCache = null; ajBolos(box);
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
      await ocupado(m.$('[data-del]'), async () => { await api.admin.massasBolo.remover(x.id); m.fechar(); cardapioAtivo = null; kitsCache = null; ajBolos(box); });
    });
    m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
      exigir(m, 'mNome', 'Informe o nome da massa.');
      const dados = { nome: valDe(m, 'mNome'), descricao: valDe(m, 'mDesc') || null, cor: valDe(m, 'mCor'), ordem: numDe(m, 'mOrd') || 0,
        slug: slugify(valDe(m, 'mSlug') || valDe(m, 'mNome').replace(/^massa\s+/i, '')), ativo: chkDe(m, 'mAtivo') };
      if (novo) await api.admin.massasBolo.criar(dados); else await api.admin.massasBolo.atualizar(x.id, dados);
      m.fechar(); toast('Massa salva.'); cardapioAtivo = null; kitsCache = null; ajBolos(box);
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
const PAPEIS = { admin: 'Administração', atendente: 'Atendimento', personalizados: 'Topos e personalizados' };
async function ajEquipe(box) {
  let equipe, prods;
  try { equipe = await api.admin.equipe.listar(); }
  catch (e) { box.innerHTML = `<div class="aviso-box">${esc(e.message)}${/não existe no banco/.test(e.message) ? ' (arquivo <code>20261003000100_equipe.sql</code>)' : ''}</div>`; return; }
  // quem produz os personalizados fica numa lista à parte (sql/topos.sql): não enxerga os pedidos da loja
  try { prods = await api.admin.personalizados.listar(); } catch (e) { prods = null; }
  const lista = [...equipe, ...(prods || []).filter(p => !equipe.some(a => a.user_id === p.user_id)).map(p => ({ ...p, papel: 'personalizados' }))];
  box.innerHTML = `<div class="aviso-box"><b>Para dar acesso a alguém:</b> 1) no Supabase, crie o usuário em Authentication → Users → Add user (com e-mail e senha);
      2) aqui, toque em “Liberar acesso” e use o mesmo e-mail. <b>Atendimento</b> vê só pedidos; <b>Administração</b> vê tudo;
      <b>Topos e personalizados</b> vê só o módulo de topos${prods ? '' : ' (para liberar, rode antes o <code>sql/topos.sql</code>)'}.</div>
    <div class="page-head" style="margin-bottom:10px"><span></span><button type="button" class="btn primary sm" data-novo-membro>${ic('mais')}Liberar acesso</button></div>
    <div class="tbl">${lista.map(a => linhaTbl({ id: a.user_id, attr: 'membro', titulo: `${a.nome}${a.user_id === perfil.user_id ? ' (você)' : ''}`,
      sub: `${a.email || 'sem e-mail'} · ${PAPEIS[a.papel] || a.papel}${a.ativo ? '' : ' · bloqueado'}${a.ultimo_acesso ? ' · último acesso ' + dataHora(a.ultimo_acesso) : ''}` })).join('')}</div>`;
  box.onclick = e => {
    const b = e.target.closest('[data-ed-membro],[data-novo-membro]'); if (!b) return;
    const a = lista.find(x => x.user_id === b.dataset.edMembro) || { papel: 'atendente', ativo: true };
    const novo = !a.user_id, eu = a.user_id === perfil.user_id;
    const m = abrirModal({
      titulo: novo ? 'Liberar acesso' : 'Editar acesso',
      corpo: `${inTxt('eEmail', 'E-mail', a.email || '', { attrs: `type="email" ${novo ? '' : 'readonly'}`, dica: novo ? 'O mesmo e-mail do usuário criado no Supabase.' : '' })}
        ${inTxt('eNome', 'Nome', a.nome || '', { attrs: 'maxlength="60"' })}
        ${inSel('ePapel', 'Acesso', [['atendente', 'Atendimento (só pedidos)'], ['admin', 'Administração (tudo)'], ...(prods ? [['personalizados', 'Topos e personalizados (só o módulo de topos)']] : [])], a.papel, { attrs: eu ? 'disabled' : '' })}
        ${eu ? '' : inChk('eAtivo', 'Acesso liberado', a.ativo)}`,
      rodape: `${novo || eu ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Tirar acesso</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
    });
    m.$('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmar(`Tirar o acesso de ${a.nome}?`, 'A pessoa não consegue mais entrar no backoffice. O usuário continua existindo no Supabase.', { botao: 'Tirar acesso', perigo: true })) return;
      await ocupado(m.$('[data-del]'), async () => {
        await (a.papel === 'personalizados' ? api.admin.personalizados : api.admin.equipe).remover(a.user_id);
        m.fechar(); ajEquipe(box);
      });
    });
    m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
      exigir(m, 'eEmail', 'Informe o e-mail.'); exigir(m, 'eNome', 'Informe o nome.');
      const dados = { email: valDe(m, 'eEmail'), nome: valDe(m, 'eNome'), papel: eu ? 'admin' : valDe(m, 'ePapel'), ativo: eu ? true : chkDe(m, 'eAtivo') };
      if (dados.papel === 'personalizados') {
        await api.admin.personalizados.salvar(dados);
        if (!novo && a.papel !== 'personalizados') await api.admin.equipe.remover(a.user_id);   // saiu da equipe da loja
      } else {
        await api.admin.equipe.salvar(dados);
        if (!novo && a.papel === 'personalizados') await api.admin.personalizados.remover(a.user_id);
      }
      m.fechar(); toast('Acesso salvo.'); ajEquipe(box);
    }));
  };
}

/* =========================================================
   TOPOS E PERSONALIZADOS (sql/topos.sql)
   Pedidos próprios de topos de bolo e personalizados (caixinhas, tags...), feitos por quem produz.
   Acesso: Administração e o perfil "Topos e personalizados". Quadro por status, como o da equipe:
   arrastar o cartão ou tocar no botão dele muda o status.
========================================================= */
const TOPO_STATUS = [
  { codigo: 'novo', nome: 'Novo', cor: '#B9476A', acao: 'Começar' },
  { codigo: 'em_producao', nome: 'Em produção', cor: '#C9A15A', acao: 'Marcar como pronto' },
  { codigo: 'pronto', nome: 'Pronto', cor: '#2B7465', acao: 'Marcar como entregue' },
  { codigo: 'entregue', nome: 'Entregue', cor: '#6E4B3A' },
  { codigo: 'cancelado', nome: 'Cancelado', cor: '#8A8A8A' }
];
const ABERTOS_TOPO = ['novo', 'em_producao', 'pronto'];
const TOPO_TIPOS = { topo: 'Topo de bolo', personalizado: 'Personalizado' };
const SUGESTOES_TOPO = ['Topo de papel', 'Topo 3D em camadas', 'Topo de acrílico', 'Topo com nome', 'Caixinhas para doces', 'Tags', 'Rótulos', 'Toppers para docinhos', 'Forminhas', 'Kit festa'];
const topoStatus = c => TOPO_STATUS.find(s => s.codigo === c) || { codigo: c, nome: c, cor: '#6E4B3A' };
const proxTopo = c => { const i = TOPO_STATUS.findIndex(s => s.codigo === c); return i >= 0 && i < 3 ? TOPO_STATUS[i + 1] : null; };
const codigoTopo = t => `TP-${String(t?.numero ?? '').padStart(4, '0')}`;
/** Quando entregar, com destaque para hoje, amanhã e atrasado (atrasado: ainda não ficou pronto e a data passou). */
function entregaTopo(t) {
  const hoje = hojeISO(), atraso = ['novo', 'em_producao'].includes(t.status) && t.data_entrega < hoje;
  const cls = atraso ? 'atraso' : !['novo', 'em_producao', 'pronto'].includes(t.status) ? '' : t.data_entrega === hoje ? 'hoje' : t.data_entrega === hojeISO(1) ? 'amanha' : '';
  return { cls, txt: `${dataCurta(t.data_entrega)}${t.hora_entrega ? ' às ' + hora(t.hora_entrega) : ''}${atraso ? ' · atrasado' : ''}` };
}
const filtroTopos = { status: 'abertos', busca: '' };
let toposCache = [], pararToposTempoReal = null, recargaTopos = null;

function erroTopos(e) {
  const semTabela = /topos_pedidos|42P01|PGRST205|schema cache|does not exist|não existe/i.test(`${e?.message} ${e?.codigo}`);
  return `<div class="vazio"><h2>${semTabela ? 'O módulo de topos ainda não está no banco' : 'Não foi possível carregar'}</h2>
    <p>${semTabela ? 'Rode no Supabase o arquivo <code>sql/topos.sql</code> (SQL Editor). Depois, é só voltar aqui.' : esc(e?.message || 'Tente de novo.')}</p></div>`;
}

async function telaTopos(el, sub) {
  const lista = sub === 'lista';
  const acoes = `<div class="vista-sel" role="group" aria-label="Ver como">
      <a class="btn sm ${lista ? 'ghost' : 'primary'}" href="#topos" ${lista ? '' : 'aria-current="page"'}>${ic('painel')}Quadro</a>
      <a class="btn sm ${lista ? 'primary' : 'ghost'}" href="#topos/lista" ${lista ? 'aria-current="page"' : ''}>${ic('pedidos')}Lista</a></div>
    ${lista ? '' : `<button type="button" class="btn ghost" data-topos-tv>${ic('tv')}Tela cheia</button>`}
    <button type="button" class="btn primary" data-topo-novo>${ic('mais')}Novo pedido</button>`;
  const chips = [['abertos', 'Em aberto'], ...TOPO_STATUS.map(s => [s.codigo, s.nome, s.cor]), ['todos', 'Todos']];
  el.innerHTML = cabecalho('Topos e personalizados', acoes, 'Topos de bolo e personalizados, do pedido à entrega.') + `
    <div class="tq-tvbar" aria-hidden="true"><strong>Topos e personalizados</strong><span id="tqRelogio"></span>
      <button type="button" class="btn sm ghost" data-topos-tv-sair>${ic('x')}Sair da tela cheia</button></div>
    ${lista ? `<div class="filtros">
      <div class="linha"><div class="busca">${ic('busca')}<label class="sr" for="tBusca">Buscar</label>
        <input class="in" id="tBusca" type="search" placeholder="O que fazer, tema, nome, cliente ou pedido" value="${esc(filtroTopos.busca)}" autocomplete="off"></div></div>
      <div class="chips" role="group" aria-label="Filtrar por status">${chips.map(([v, t, cor]) => `<button type="button" class="chip" data-tfst="${v}" aria-pressed="${v === filtroTopos.status}">${cor ? `<span class="dot" style="background:${cor}"></span>` : ''}${t}</button>`).join('')}</div>
    </div>` : ''}
    <div id="toposCorpo">${lista ? '<div class="skel" style="height:280px"></div>' : '<div class="tq">' + '<div class="skel" style="height:320px"></div>'.repeat(4) + '</div>'}</div>`;
  if (lista) {
    let t;
    $('#tBusca').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filtroTopos.busca = e.target.value; carregarTopos(); }, 300); });
  }
  await carregarTopos();
}

async function carregarTopos() {
  const corpo = $('#toposCorpo'); if (!corpo) return;
  const lista = rotaAtual === 'topos/lista';
  try {
    if (lista) {
      const st = filtroTopos.status === 'abertos' ? ABERTOS_TOPO : filtroTopos.status === 'todos' ? null : filtroTopos.status;
      toposCache = await api.admin.topos.listar({ status: st, busca: filtroTopos.busca, crescente: filtroTopos.status === 'abertos' || ABERTOS_TOPO.includes(filtroTopos.status), limite: 300 });
      corpo.innerHTML = listaTopos(toposCache);
    } else {
      // quadro: tudo em aberto, mais o que foi entregue nos últimos dias
      const [abertos, entregues] = await Promise.all([api.admin.topos.listar({ status: ABERTOS_TOPO }), api.admin.topos.listar({ status: 'entregue', entregaDesde: hojeISO(-2) })]);
      toposCache = [...abertos, ...entregues];
      corpo.innerHTML = quadroTopos(toposCache);
    }
  } catch (e) { corpo.innerHTML = erroTopos(e); return; }
  atualizarBadgeTopos();
}

/* ---- Quadro: a esteira da produção ----
   Responde "o que eu faço agora?". No alto, o foco do dia (atrasados, para hoje, para amanhã, prontos para entregar):
   tocar destaca esses cartões. Nas colunas, os cartões em ordem de prazo, separados por dia. O cartão é uma ficha: o prazo
   em cima (com quanto falta), a imagem de referência, o que fazer e a frase que vai escrita, e o próximo passo na cor da
   etapa para onde ele vai. Ao avançar, dá para desfazer. No celular, as etapas viram abas. */
const COLUNAS_TOPO = {
  novo: { dica: 'Esperando começar', vazio: 'Nenhum pedido novo.', curto: 'Novo' },
  em_producao: { dica: 'Na bancada agora', vazio: 'Nada em produção agora.', curto: 'Produção' },
  pronto: { dica: 'Esperando a entrega', vazio: 'Nada pronto esperando entrega.', curto: 'Pronto' },
  entregue: { dica: 'Nos últimos dois dias', vazio: 'Nada entregue nos últimos dias.', curto: 'Entregue' }
};
const GRUPOS_PRAZO = { atraso: 'Atrasado', hoje: 'Hoje', amanha: 'Amanhã', semana: 'Próximos dias', depois: 'Mais pra frente' };
const FOCOS_TOPO = [['atraso', 'atrasado', 'atrasados'], ['hoje', 'para hoje', 'para hoje'], ['amanha', 'para amanhã', 'para amanhã'], ['entregar', 'pronto para entregar', 'prontos para entregar']];
let focoTopos = null, abaTopos = null, topoQueChegou = null;
/** Quanto tempo, curto: "40 min", "2 h 30", "5 h", "3 dias". */
function duracao(min) {
  min = Math.round(Math.abs(min));
  if (min < 60) return `${min} min`;
  if (min < 1440) { const h = Math.floor(min / 60), m = min % 60; return h < 3 && m >= 10 ? `${h} h ${String(m).padStart(2, '0')}` : `${Math.round(min / 60)} h`; }
  const d = Math.round(min / 1440); return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}
const chavePrazo = t => `${t.data_entrega}T${hora(t.hora_entrega) || '23:59'}`;   // sem horário, vale até o fim do dia
const hojeISODe = iso => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(iso));   // o dia (em Brasília) de um instante
/** "Hoje", "Ontem", "Amanhã" ou "ter, 13/10". */
const nomeDoDia = iso => (iso === hojeISO(-1) ? 'Ontem' : dataCurta(iso));
/** Em que grupo do quadro cai um dia que ainda não passou. */
function grupoPrazo(dia) {
  if (dia === hojeISO()) return 'hoje';
  if (dia === hojeISO(1)) return 'amanha';
  return dia <= hojeISO(6) ? 'semana' : 'depois';
}
/** Quanto falta, ao lado do prazo ("em 3 h"); para amanhã, o horário já diz tudo. */
function faltaPrazo(t, minutos) {
  if (t.data_entrega === hojeISO(1)) return '';
  if (t.data_entrega === hojeISO() && !t.hora_entrega) return 'até o fim do dia';
  return `em ${duracao(minutos)}`;
}
/** Prazo do pedido de topo no quadro: grupo (atraso, hoje, amanha, semana, depois; feito para o entregue), rótulo e quanto falta. */
function prazoTopo(t) {
  if (!ABERTOS_TOPO.includes(t.status)) {
    const dia = nomeDoDia(t.atualizado_em ? hojeISODe(t.atualizado_em) : t.data_entrega);
    return { urg: 'feito', rotulo: `Entregue ${{ Hoje: 'hoje', Ontem: 'ontem' }[dia] || dia}`, rel: '' };
  }
  const falta = (new Date(`${chavePrazo(t)}:00-03:00`) - Date.now()) / 6e4;   // Brasília (sem horário de verão desde 2019)
  const rotulo = nomeDoDia(t.data_entrega) + (t.hora_entrega ? ' · ' + hora(t.hora_entrega) : '');
  if (falta < 0) return { urg: 'atraso', rotulo, rel: t.status === 'pronto' ? 'falta entregar' : `atrasado ${duracao(falta)}` };
  return { urg: grupoPrazo(t.data_entrega), rotulo, rel: faltaPrazo(t, falta) };
}
/** No celular, a etapa aberta: a escolhida antes; senão, a que tem algo atrasado ou para hoje; senão, a primeira com pedidos. */
function abaInicialTopos(lista) {
  if (abaTopos) return abaTopos;
  try { const s = sessionStorage.getItem('ritabolos.topos.aba'); if (COLUNAS_TOPO[s]) return s; } catch (e) { /* sem armazenamento */ }
  const quente = ['em_producao', 'novo', 'pronto'].find(c => lista.some(t => t.status === c && ['atraso', 'hoje'].includes(prazoTopo(t).urg)));
  return quente || Object.keys(COLUNAS_TOPO).find(c => lista.some(t => t.status === c)) || 'novo';
}

function quadroTopos(lista) {
  const conta = { atraso: 0, hoje: 0, amanha: 0, entregar: 0 };
  lista.filter(t => ABERTOS_TOPO.includes(t.status)).forEach(t => {
    const u = prazoTopo(t).urg; if (u in conta) conta[u]++;
    if (t.status === 'pronto') conta.entregar++;
  });
  if (focoTopos && !conta[focoTopos]) focoTopos = null;   // o destaque esvaziou (ex.: o último atrasado ficou pronto)
  const aba = abaInicialTopos(lista), etapas = TOPO_STATUS.slice(0, 4);
  const doStatus = c => lista.filter(t => t.status === c);
  return `<div class="tq-quadro" ${focoTopos ? `data-foco="${focoTopos}"` : ''}>
    <div class="tq-foco" role="group" aria-label="Destacar no quadro">${FOCOS_TOPO.map(([v, um, varios]) => `<button type="button" class="tq-chip ${v}" data-tq-foco="${v}" aria-pressed="${focoTopos === v}" ${conta[v] ? '' : 'disabled'}><b>${conta[v]}</b>${conta[v] === 1 ? um : varios}</button>`).join('')}
      ${focoTopos ? '<button type="button" class="link tq-limpar" data-tq-foco="">Mostrar tudo</button>' : ''}</div>
    <div class="tq-abas" role="tablist" aria-label="Etapas">${etapas.map(s => {
      const itens = doStatus(s.codigo), quente = s.codigo !== 'entregue' && itens.some(t => ['atraso', 'hoje'].includes(prazoTopo(t).urg));
      return `<button type="button" role="tab" class="tq-aba" data-tq-aba="${s.codigo}" aria-selected="${s.codigo === aba}" style="${corVars(s.cor)}">${esc(COLUNAS_TOPO[s.codigo].curto)}<span class="tq-n">${itens.length}${quente ? '<i aria-label="tem pedido para hoje ou atrasado"></i>' : ''}</span></button>`;
    }).join('')}</div>
    <div class="tq">${etapas.map(s => colunaTopo(s, doStatus(s.codigo), s.codigo === aba)).join('')}</div>
  </div>`;
}
function colunaTopo(s, itens, ativa) {
  const fim = s.codigo === 'entregue', c = COLUNAS_TOPO[s.codigo];
  if (fim) itens.sort((a, b) => (a.atualizado_em < b.atualizado_em ? 1 : -1));
  else itens.sort((a, b) => chavePrazo(a).localeCompare(chavePrazo(b)));
  let grupo = null;
  const cartoes = itens.map(t => {
    const p = prazoTopo(t), divisa = !fim && p.urg !== grupo ? `<p class="tq-grupo ${p.urg}">${GRUPOS_PRAZO[p.urg]}</p>` : '';
    grupo = p.urg;
    return divisa + cartaoTopo(t, p);
  }).join('');
  return `<section class="tq-col ${fim ? 'fim' : ''} ${ativa ? 'ativa' : ''}" data-col="${s.codigo}" style="${corVars(s.cor)}" aria-labelledby="tqc-${s.codigo}">
    <header class="tq-h"><h2 id="tqc-${s.codigo}">${esc(s.nome)}</h2><span class="tq-n" aria-label="${itens.length} pedidos">${itens.length}</span><small>${esc(c.dica)}</small></header>
    <div class="tq-cards" data-drop="${s.codigo}" data-solte="Soltar em ${esc(s.nome)}">${cartoes || `<p class="tq-vazio">${ic(fim ? 'ok' : 'topo')}${esc(c.vazio)}</p>`}</div>
  </section>`;
}

function cartaoTopo(t, p = prazoTopo(t)) {
  const s = topoStatus(t.status), prox = proxTopo(t.status), img = t.referencias?.[0];
  const icone = t.tipo === 'personalizado' ? 'presente' : 'topo';   // sem imagem de referência: o ícone do tipo
  const mini = img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ic(icone);
  if (p.urg === 'feito') return `<article class="tq-card mini" data-topo-card="${esc(t.id)}" data-st="${t.status}">
    <button type="button" class="tq-corpo" data-topo="${esc(t.id)}" aria-label="Abrir ${codigoTopo(t)}: ${esc(t.titulo)}, ${esc(p.rotulo)}">
      <span class="tq-mini">${mini}</span>
      <span class="tq-txt"><strong class="tq-tit">${t.quantidade > 1 ? `${t.quantidade}× ` : ''}${esc(t.titulo)}</strong><span class="tq-meta">${esc(p.rotulo)}${t.cliente_nome ? ' · ' + esc(t.cliente_nome) : ''}</span></span>
    </button></article>`;
  const nw = v => `<span class="nw">${esc(v)}</span>`;   // código não quebra no hífen
  const meta = [t.tema && esc(t.tema), t.cliente_nome && esc(t.cliente_nome), t.pedido_codigo && nw(t.pedido_codigo)].filter(Boolean).join(' · ');
  return `<article class="tq-card ${t.id === topoQueChegou ? 'chegou' : ''}" draggable="true" data-topo-card="${esc(t.id)}" data-urg="${p.urg}" data-st="${t.status}">
    <div class="tq-prazo">${ic(p.urg === 'atraso' ? 'alerta' : 'relogio')}<span>${esc(p.rotulo)}</span>${p.rel ? `<em>${esc(p.rel)}</em>` : ''}</div>
    <button type="button" class="tq-corpo" data-topo="${esc(t.id)}" aria-label="Abrir ${codigoTopo(t)}: ${esc(t.titulo)}, ${esc(p.rotulo)}">
      <span class="tq-mini">${mini}${t.quantidade > 1 ? `<b class="tq-qtd">${t.quantidade}×</b>` : ''}</span>
      <span class="tq-txt">
        <span class="tq-tipo">${esc(TOPO_TIPOS[t.tipo] || t.tipo)} · ${nw(codigoTopo(t))}</span>
        <strong class="tq-tit">${esc(t.titulo)}</strong>
        ${t.texto ? `<q class="tq-frase">${esc(t.texto)}</q>` : ''}
        ${meta ? `<span class="tq-meta">${meta}</span>` : ''}
      </span>
    </button>
    ${prox ? `<button type="button" class="tq-ir" data-topo-avancar="${esc(t.id)}" data-para="${prox.codigo}" style="--n:${esc(prox.cor)};--n-rgb:${rgbDe(prox.cor)}">${esc(s.acao)}${ic('seta')}</button>` : ''}
  </article>`;
}

function listaTopos(lista) {
  if (!lista.length) return `<div class="card"><p class="vazio">${filtroTopos.busca ? 'Nada encontrado com essa busca.' : 'Nenhum pedido aqui.'}</p></div>`;
  return `<section class="card tabela" aria-label="Pedidos de topos e personalizados">
    <div class="tab-cab" aria-hidden="true"><span>Entrega</span><span>O que fazer</span><span>Status e valor</span></div>
    <div class="lista-ped">${lista.map(t => {
      const s = topoStatus(t.status), e = entregaTopo(t);
      const det = [TOPO_TIPOS[t.tipo], t.tema && `Tema: ${t.tema}`, t.texto && `“${t.texto}”`, t.cliente_nome, t.pedido_codigo].filter(Boolean).join(' · ');
      return `<button type="button" class="ped" data-topo="${esc(t.id)}" aria-label="${codigoTopo(t)}: ${esc(t.titulo)}, entrega ${esc(e.txt)}">
        <span class="quando ${e.cls}">${esc(dataCurta(t.data_entrega))}${e.cls === 'atraso' ? ' (atrasado)' : ''}<small>${t.hora_entrega ? esc(hora(t.hora_entrega)) : 'sem horário'}</small></span>
        <span class="meio"><span class="nome">${t.quantidade > 1 ? `${t.quantidade}× ` : ''}${esc(t.titulo)} <span class="cod">${codigoTopo(t)}</span></span><span class="itens">${esc(det)}</span></span>
        <span class="dir">${pill(s.nome, s.cor)}${Number(t.valor) > 0 ? `<span class="total">${R(t.valor)}</span>${t.pago ? `<span class="tag pago">${ic('ok')}Pago</span>` : '<span class="tag pend">A receber</span>'}` : ''}</span>
      </button>`;
    }).join('')}</div></section>`;
}

/** Muda o status (botão do cartão, arrastar no quadro ou a ficha do pedido). O aviso traz "Desfazer", que volta para onde estava. */
async function mudarStatusTopo(id, para, btn, { desfazer = true } = {}) {
  const t = toposCache.find(x => x.id === id), de = t?.status;
  if (t && t.status === para) return true;
  if (para === 'cancelado' && !await confirmar('Cancelar este pedido?', `${t ? codigoTopo(t) + ': ' + t.titulo : 'O pedido'} sai do quadro. Dá para voltar o status depois.`, { botao: 'Cancelar pedido', perigo: true })) return false;
  return ocupado(btn, async () => {
    const r = await api.admin.topos.alterarStatus(id, para);
    topoQueChegou = id;   // o cartão chega brilhando na coluna nova
    setTimeout(() => { if (topoQueChegou === id) topoQueChegou = null; }, 1600);
    const volta = desfazer && de && de !== para ? { rotulo: 'Desfazer', fn: () => mudarStatusTopo(id, de, null, { desfazer: false }) } : null;
    toast(`${codigoTopo(r)} foi para ${topoStatus(para).nome}.`, { acao: volta, tempo: volta ? 7000 : 4200 });
    if (telaAtual === 'topos') await carregarTopos();
    else atualizarBadgeTopos();
    return true;
  });
}
/* Foco do dia (destacar) e, no celular, as abas das etapas: só redesenham o quadro, sem buscar de novo */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tq-foco],[data-tq-aba]'); if (!b || !$('#toposCorpo')) return;
  if (b.dataset.tqAba) {
    abaTopos = b.dataset.tqAba;
    try { sessionStorage.setItem('ritabolos.topos.aba', abaTopos); } catch (err) { /* só nesta visita */ }
  } else focoTopos = b.dataset.tqFoco && b.dataset.tqFoco !== focoTopos ? b.dataset.tqFoco : null;
  $('#toposCorpo').innerHTML = quadroTopos(toposCache);
  $(`[data-tq-${b.dataset.tqAba ? 'aba' : 'foco'}="${b.dataset.tqAba || focoTopos || ''}"]`)?.focus();   // o foco do teclado fica no botão tocado
});

/* Cliques e arrastar do módulo (quadro, lista, botões do cabeçalho) */
document.addEventListener('click', e => {
  if (!perfil || !podeTopos()) return;
  const b = e.target.closest('[data-topo-novo],[data-topos-tv],[data-topos-tv-sair],[data-topo-avancar],[data-topo],[data-tfst]');
  if (!b || b.closest('.modal-veu')) return;
  if (b.dataset.topoNovo !== undefined) modalTopoForm();
  else if (b.dataset.toposTv !== undefined) entrarTvTopos();
  else if (b.dataset.toposTvSair !== undefined) sairTvTopos();
  else if (b.dataset.topoAvancar) mudarStatusTopo(b.dataset.topoAvancar, b.dataset.para, b);
  else if (b.dataset.topo) abrirTopo(b.dataset.topo);
  else if (b.dataset.tfst) { filtroTopos.status = b.dataset.tfst; $$('[data-tfst]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); carregarTopos(); }
});
document.addEventListener('dragstart', e => {
  const c = e.target.closest?.('[data-topo-card]'); if (!c) return;
  e.dataTransfer.setData('text/plain', c.dataset.topoCard); e.dataTransfer.effectAllowed = 'move';
  c.classList.add('arrastando');
});
document.addEventListener('dragend', e => { e.target.closest?.('[data-topo-card]')?.classList.remove('arrastando'); $$('.tq-cards.sobre').forEach(x => x.classList.remove('sobre')); });
document.addEventListener('dragover', e => {
  const z = e.target.closest?.('[data-drop]'); if (!z) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  if (!z.classList.contains('sobre')) { $$('.tq-cards.sobre').forEach(x => x.classList.remove('sobre')); z.classList.add('sobre'); }
});
document.addEventListener('drop', e => {
  const z = e.target.closest?.('[data-drop]'); if (!z) return;
  e.preventDefault(); z.classList.remove('sobre');
  const id = e.dataTransfer.getData('text/plain');
  if (id && toposCache.some(t => t.id === id)) mudarStatusTopo(id, z.dataset.drop, null);
});

/* ---- Ficha do pedido de topo ---- */
async function abrirTopo(id, depois) {
  let t, hist;
  try { [t, hist] = await Promise.all([api.admin.topos.obter(id), api.admin.topos.historico(id).catch(() => [])]); }
  catch (e) { erroToast(e); return; }
  const s = topoStatus(t.status), prox = proxTopo(t.status), e = entregaTopo(t), tel = telefoneWa(t.cliente_telefone);
  const refs = t.referencias || [];
  const m = abrirModal({
    titulo: `${codigoTopo(t)} · ${t.titulo}`, largo: true,
    corpo: `<div class="tp-det">
      <div class="status-sel" role="group" aria-label="Mudar status">${TOPO_STATUS.map(x => `<button type="button" class="st-btn" data-topo-st="${x.codigo}" ${x.codigo === t.status ? `aria-current="true" style="background:${x.cor};color:${corTexto(x.cor)}"` : ''}><span class="dot" style="background:${x.cor}"></span>${esc(x.nome)}</button>`).join('')}</div>
      ${prox ? `<button type="button" class="btn teal block prox" data-topo-st="${prox.codigo}">${ic('ok')}${esc(s.acao)}</button>` : ''}
      ${refs.length ? `<p class="secao-t">Imagens de referência</p><div class="tp-refs">${refs.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener" title="Abrir a imagem"><img src="${esc(u)}" alt="Referência ${i + 1}" loading="lazy"></a>`).join('')}</div>`
        : '<p class="aviso-box" style="margin:16px 0 0">Sem imagem de referência. Dá para anexar em Editar.</p>'}
      <p class="secao-t">Detalhes</p>
      <dl class="kv">
        <dt>Tipo</dt><dd>${esc(TOPO_TIPOS[t.tipo] || t.tipo)}${t.quantidade > 1 ? ` · ${t.quantidade} unidades` : ''}</dd>
        <dt>Entrega</dt><dd><span class="tq-quando ${e.cls}">${esc(formatarData(t.data_entrega))} (${esc(dataCurta(t.data_entrega))})${t.hora_entrega ? ' às ' + esc(hora(t.hora_entrega)) : ''}</span></dd>
        ${t.tema ? `<dt>Tema</dt><dd>${esc(t.tema)}</dd>` : ''}
        ${t.texto ? `<dt>Texto</dt><dd>“${esc(t.texto)}”</dd>` : ''}
        ${t.detalhes ? `<dt>Detalhes</dt><dd style="white-space:pre-line;text-align:left">${esc(t.detalhes)}</dd>` : ''}
        ${t.cliente_nome || t.cliente_telefone ? `<dt>Cliente</dt><dd>${esc(t.cliente_nome || '')}${t.cliente_telefone ? `${t.cliente_nome ? ' · ' : ''}<a href="tel:${esc(String(t.cliente_telefone).replace(/[^\d+]/g, ''))}">${esc(formatarTel(t.cliente_telefone) || t.cliente_telefone)}</a>` : ''}</dd>` : ''}
        ${t.pedido_codigo ? `<dt>Pedido da loja</dt><dd>${isAdmin() && t.pedido_id ? `<button type="button" class="link" data-topo-pedido="${esc(t.pedido_id)}">${esc(t.pedido_codigo)}</button>` : esc(t.pedido_codigo)}</dd>` : ''}
        <dt>Valor</dt><dd>${Number(t.valor) > 0 ? `${R(t.valor)} · ${t.pago ? 'pago' : 'a receber'}` : '—'}</dd>
      </dl>
      <p class="secao-t">Histórico</p>
      <ul class="hist">${hist.slice().reverse().map(h => `<li style="--c:${esc(topoStatus(h.status_novo).cor)}"><b>${esc(topoStatus(h.status_novo).nome)}</b>
        <small>${esc(dataHora(h.criado_em))}${h.autor_nome ? ' · ' + esc(h.autor_nome) : ''}</small></li>`).join('') || '<li><small>Sem registros.</small></li>'}</ul>
    </div>`,
    rodape: `${isAdmin() ? `<button type="button" class="btn danger esq" data-topo-excluir>${ic('lixo')}Excluir</button>` : ''}
      ${tel ? `<button type="button" class="btn wa" data-topo-wa>${ic('wa')}WhatsApp</button>` : ''}
      <button type="button" class="btn ghost" data-topo-editar>${ic('editar')}Editar</button><button type="button" class="btn primary" data-fechar>Fechar</button>`
  });
  const mudou = () => { depois?.(); if (telaAtual === 'topos') carregarTopos(); else atualizarBadgeTopos(); };
  m.$$('[data-topo-st]').forEach(b => b.addEventListener('click', async () => {
    toposCache = toposCache.some(x => x.id === t.id) ? toposCache : [...toposCache, t];
    const ok = await mudarStatusTopo(t.id, b.dataset.topoSt, b);
    if (ok) { m.fechar(); depois?.(); abrirTopo(t.id, depois); }
  }));
  m.$('[data-topo-editar]').addEventListener('click', () => { m.fechar(); modalTopoForm(t, {}, mudou); });
  m.$('[data-topo-pedido]')?.addEventListener('click', ev => { m.fechar(); location.hash = '#pedidos@' + ev.currentTarget.dataset.topoPedido; });
  m.$('[data-topo-wa]')?.addEventListener('click', () => {
    const nome = String(t.cliente_nome || '').trim().split(/\s+/)[0];
    const oQue = `${t.quantidade > 1 ? t.quantidade + '× ' : ''}${t.titulo}${t.tema ? ` (${t.tema})` : ''}`;
    const msg = t.status === 'pronto'
      ? `Olá${nome ? ', ' + nome : ''}! Aqui é da Rita Bolos. Seu pedido ${codigoTopo(t)}, ${oQue}, está *pronto*!`
      : `Olá${nome ? ', ' + nome : ''}! Aqui é da Rita Bolos. Estou falando sobre o seu pedido ${codigoTopo(t)}: ${oQue}, para ${formatarData(t.data_entrega)}.`;
    abrirWhatsApp(linkWhatsApp(tel, msg));
  });
  m.$('[data-topo-excluir]')?.addEventListener('click', async () => {
    if (!await confirmar(`Excluir ${codigoTopo(t)}?`, 'O pedido e o histórico dele serão apagados de vez. Para desistências, prefira o status “Cancelado”.', { botao: 'Excluir de vez', perigo: true })) return;
    await ocupado(m.$('[data-topo-excluir]'), async () => { await api.admin.topos.remover(t.id); m.fechar(); toast(`${codigoTopo(t)} excluído.`); mudou(); });
  });
}

/* ---- Novo pedido / editar. base: dados já preenchidos (ex.: vindo do pedido do bolo) ---- */
function modalTopoForm(t = null, base = {}, depois) {
  const novo = !t;
  const d = t || { tipo: 'topo', quantidade: 1, referencias: [], valor: 0, pago: false, data_entrega: hojeISO(1), ...base };
  let refs = [...(d.referencias || [])];
  const m = abrirModal({
    titulo: novo ? 'Novo pedido de topo ou personalizado' : `Editar ${codigoTopo(t)}`, largo: true,
    corpo: `${d.pedido_codigo && d.pedido_id ? `<div class="aviso-box">Para o pedido <b>${esc(d.pedido_codigo)}</b>${d.cliente_nome ? ` de ${esc(d.cliente_nome)}` : ''}.</div>` : ''}
      <div class="grid3">${inSel('tfTipo', 'Tipo', Object.entries(TOPO_TIPOS), d.tipo)}${inTxt('tfTitulo', 'O que fazer', d.titulo || '', { attrs: 'maxlength="80" list="tfSugestoes" placeholder="Ex.: Topo de papel" autocomplete="off"' })}${inNum('tfQtd', 'Quantidade', d.quantidade || 1, { attrs: 'min="1" max="9999"' })}</div>
      <datalist id="tfSugestoes">${SUGESTOES_TOPO.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
      <div class="grid2">${inTxt('tfTema', 'Tema', d.tema || '', { attrs: 'maxlength="80" placeholder="Ex.: Safari, Frozen, futebol"' })}${inTxt('tfTexto', 'Texto', d.texto || '', { attrs: 'maxlength="120" placeholder="Ex.: Theo, 1 ano"', dica: 'Nome, idade ou frase que vai escrito.' })}</div>
      ${inTa('tfDet', 'Detalhes', d.detalhes || '', { attrs: 'maxlength="1500" style="min-height:70px" placeholder="Cores, tamanho, acabamento…"' })}
      <div class="field"><span class="lbl">Imagens de referência</span><div class="tf-refs" id="tfRefs"></div></div>
      <div class="grid2">${campo('tfData', 'Data de entrega', `<input class="in" id="tfData" type="date" value="${esc(d.data_entrega || '')}">`, d.pedido_id ? 'Topo de bolo: até a retirada do bolo.' : '')}${campo('tfHora', 'Horário', `<input class="in" id="tfHora" type="time" value="${esc(hora(d.hora_entrega))}">`)}</div>
      <div class="grid2">${inTxt('tfCli', 'Cliente', d.cliente_nome || '', { attrs: 'maxlength="120"' })}${inTxt('tfTel', 'Telefone (DDD + número)', formatarTel(d.cliente_telefone) || '', { attrs: ATTR_TEL })}</div>
      ${d.pedido_id ? '' : inTxt('tfPed', 'Pedido da loja (opcional)', d.pedido_codigo || '', { attrs: 'maxlength="20" placeholder="Ex.: RB-01042"', dica: 'Código do pedido do bolo, quando o topo é para um bolo da loja.' })}
      <div class="grid2">${inDin('tfValor', 'Valor', d.valor, { dica: 'Opcional.' })}<div class="field tf-pago">${inChk('tfPago', 'Já está pago', d.pago)}</div></div>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>${novo ? 'Criar pedido' : 'Salvar'}</button>`
  });
  const desenharRefs = () => {
    m.$('#tfRefs').innerHTML = refs.map((u, i) => `<span class="tf-ref"><img src="${esc(u)}" alt="Referência ${i + 1}"><button type="button" class="btn icon sm" data-tirar-ref="${i}" aria-label="Tirar a imagem ${i + 1}">${ic('x')}</button></span>`).join('')
      + `<label class="tf-add">${ic('foto')}<span>${refs.length ? 'Mais uma' : 'Anexar imagem'}</span><input type="file" accept="image/*" multiple class="sr" id="tfArq"></label>`;
  };
  desenharRefs();
  m.$('#tfRefs').addEventListener('click', e => { const b = e.target.closest('[data-tirar-ref]'); if (b) { refs.splice(Number(b.dataset.tirarRef), 1); desenharRefs(); } });
  m.$('#tfRefs').addEventListener('change', async e => {
    if (e.target.id !== 'tfArq') return;
    const arquivos = [...e.target.files]; if (!arquivos.length) return;
    const rot = m.$('.tf-add span'); rot.textContent = 'Enviando…';
    try {
      for (const a of arquivos) {
        if (!/^image\//.test(a.type || '')) throw new Error('Escolha arquivos de imagem.');
        refs.push((await api.referencias.enviar(await reduzirImagem(a))).url);
      }
    } catch (err) { erroToast(err); }
    desenharRefs();
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'tfTitulo', 'Diga o que fazer (ex.: Topo de papel).');
    exigir(m, 'tfData', 'Informe a data de entrega.');
    const qtd = numDe(m, 'tfQtd');
    if (!(qtd >= 1)) throw new Error('A quantidade precisa ser pelo menos 1.');
    if (!telOk(valDe(m, 'tfTel'))) throw new Error('Telefone incompleto: informe DDD + número, ex.: (19) 99999-9999.');
    const valor = lerValor(valDe(m, 'tfValor'));
    if (Number.isNaN(valor) || valor < 0) throw new Error('Confira o valor (ex.: 25,00).');
    const dados = {
      tipo: valDe(m, 'tfTipo'), titulo: valDe(m, 'tfTitulo'), quantidade: Math.round(qtd), tema: valDe(m, 'tfTema') || null, texto: valDe(m, 'tfTexto') || null,
      detalhes: valDe(m, 'tfDet') || null, referencias: refs, data_entrega: valDe(m, 'tfData'), hora_entrega: valDe(m, 'tfHora') || null,
      cliente_nome: valDe(m, 'tfCli') || null, cliente_telefone: formatarTel(valDe(m, 'tfTel')) || null, valor: valor || 0, pago: chkDe(m, 'tfPago'),
      pedido_id: d.pedido_id || null, pedido_codigo: d.pedido_id ? d.pedido_codigo : (valDe(m, 'tfPed').toUpperCase() || null), pedido_item_id: d.pedido_item_id || null
    };
    // a Administração pode ligar pelo código a um pedido da loja (quem produz não vê os pedidos)
    if (!dados.pedido_id && dados.pedido_codigo && isAdmin()) {
      const { pedidos } = await api.admin.pedidos.listar({ busca: dados.pedido_codigo, porPagina: 5 }).catch(() => ({ pedidos: [] }));
      const p = pedidos.find(x => String(x.codigo).toUpperCase() === dados.pedido_codigo);
      if (p) dados.pedido_id = p.id;
    }
    const r = novo ? await api.admin.topos.criar(dados) : await api.admin.topos.atualizar(t.id, dados);
    m.fechar();
    toast(novo ? `Pedido ${codigoTopo(r)} criado.` : `${codigoTopo(r)} salvo.`, novo ? { acao: { rotulo: 'Ver', fn: () => abrirTopo(r.id, depois) } } : {});
    depois?.();
    if (telaAtual === 'topos') carregarTopos(); else atualizarBadgeTopos();
  }));
}

/* ---- Ligação com o pedido do bolo (gaveta do pedido, só a Administração) ---- */
/** Nos itens de topper do pedido aberto: o status do pedido de topo já criado, ou o botão para criar. */
async function toposDaGaveta(p) {
  if (!p || !isAdmin() || !$$('#gaveta [data-topo-vinc]').length) return;
  let lista;
  try { lista = await api.admin.topos.listar({ pedidoId: p.id }); } catch (e) { return; }   // sem o sql/topos.sql: fica como antes
  if (pedidoAtual?.id !== p.id) return;
  $$('#gaveta [data-topo-vinc]').forEach(v => {
    const ligados = lista.filter(t => t.pedido_item_id === v.dataset.topoVinc && t.status !== 'cancelado');
    v.innerHTML = ligados.length
      ? ligados.map(t => `<button type="button" class="btn sm ghost" data-gav="topo-ver" data-id="${esc(t.id)}" style="${corVars(topoStatus(t.status).cor)}">${ic('topo')}${codigoTopo(t)} · <span class="pill">${esc(topoStatus(t.status).nome)}</span></button>`).join('')
      : `<button type="button" class="btn sm ghost" data-gav="topo-novo" data-item="${esc(v.dataset.topoVinc)}">${ic('topo')}Criar pedido de topo</button>`;
  });
}
function novoTopoDoItem(p, i) {
  const { texto, imagem } = separarReferencia(i.observacao);
  modalTopoForm(null, { tipo: 'topo', titulo: i.nome, quantidade: i.quantidade || 1, detalhes: texto || null, referencias: imagem ? [imagem] : [],
    data_entrega: p.data_retirada, hora_entrega: p.hora_retirada || null, cliente_nome: p.cliente_nome, cliente_telefone: p.cliente_telefone || null,
    pedido_id: p.id, pedido_codigo: p.codigo, pedido_item_id: String(i.id) }, () => toposDaGaveta(pedidoAtual));
}

/* ---- Contador de pedidos novos no menu e tempo real ---- */
async function atualizarBadgeTopos() {
  if (!podeTopos()) return false;
  try {
    const n = (await api.admin.topos.listar({ status: 'novo' })).length;
    $$('[data-badge-topos]').forEach(b => { b.textContent = n > 99 ? '99+' : n; b.hidden = !n; b.title = `${n} pedido(s) de topo novo(s)`; });
    return true;
  } catch (e) { return false; }
}
function ligarTempoRealTopos() {
  pararToposTempoReal?.();
  pararToposTempoReal = api.admin.topos.aoMudar(({ tipo, topo }) => {
    if (tipo === 'INSERT' && topo?.id && topo.criado_por !== perfil?.user_id) {
      tocarAviso();
      toast(`Novo pedido de topo ${codigoTopo(topo)}: ${topo.titulo || ''}`, { tipo: 'novo', acao: { rotulo: 'Ver', fn: () => abrirTopo(topo.id) }, tempo: 12000 });
    }
    clearTimeout(recargaTopos);
    recargaTopos = setTimeout(() => {
      if (telaAtual === 'topos') carregarTopos(); else atualizarBadgeTopos();
      if (pedidoAtual && $('#gaveta')?.classList.contains('on')) toposDaGaveta(pedidoAtual);
    }, 500);
  });
}

/* ---- Tela cheia (TV na bancada): esconde o menu, cartões maiores, relógio e atualização sozinha ---- */
let tvTopos = null;
async function entrarTvTopos() {
  if (rotaAtual !== 'topos') return;
  document.body.classList.add('tv-topos');
  try { await document.documentElement.requestFullscreen?.(); } catch (e) { /* segue sem tela cheia de verdade */ }
  let trava = null;
  try { trava = await navigator.wakeLock?.request('screen'); } catch (e) { trava = null; }
  const relogio = () => {
    const r = $('#tqRelogio'); if (!r) return;
    const s = new Date().toLocaleString('pt-BR', { timeZone: FUSO, weekday: 'long', hour: '2-digit', minute: '2-digit' });
    r.textContent = s.charAt(0).toUpperCase() + s.slice(1);
  };
  relogio();
  tvTopos = { trava, timers: [setInterval(relogio, 15e3), setInterval(() => carregarTopos(), 60e3)] };
}
function sairTvTopos() {
  if (!tvTopos && !document.body.classList.contains('tv-topos')) return;
  document.body.classList.remove('tv-topos');
  tvTopos?.timers.forEach(clearInterval);
  tvTopos?.trava?.release?.().catch?.(() => {});
  tvTopos = null;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && tvTopos) sairTvTopos(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tvTopos && !pilhaModais.length) sairTvTopos(); });

/* =========================================================
   ESTOQUE (sql/estoque.sql), só a Administração.
   Itens com quantidade e estoque mínimo; entrada, saída e contagem ficam no histórico. Itens ligados
   a produtos do cardápio saem sozinhos quando o pedido é confirmado (e voltam se ele for cancelado).
   Ao chegar no mínimo, o banco cria o aviso do sino.
========================================================= */
const UNIDADES_ESTOQUE = [['unidade', 'unidade'], ['caixa', 'caixa'], ['pacote', 'pacote'], ['lata', 'lata'], ['garrafa', 'garrafa'], ['saco', 'saco'], ['rolo', 'rolo'], ['dúzia', 'dúzia'],
  ['kg', 'kg (quilo)'], ['g', 'g (grama)'], ['L', 'L (litro)'], ['ml', 'ml (mililitro)']];
const CATEGORIAS_ESTOQUE = ['Ingredientes', 'Embalagens', 'Bebidas', 'Decoração', 'Descartáveis', 'Limpeza'];
const SITUACAO_EST = { ok: ['Em dia', 'pago'], acabando: ['Acabando', 'sinal'], acabou: ['Acabou', 'pend'], pausado: ['Sem aviso', 'cinza'] };
const TIPO_MOV_EST = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Contagem', pedido: 'Pedido' };
const numEst = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const unidadeEst = (q, u) => (['kg', 'g', 'L', 'ml'].includes(u) ? u : u + (Math.abs(Number(q)) === 1 ? '' : 's'));
const qtdEst = (q, u) => `${numEst(q)} ${unidadeEst(q, u)}`;
/** Quantidade digitada ("2,5", "12") com até 3 casas; null se vazio, NaN se não for número. */
function lerQtd(s) {
  s = String(s ?? '').trim(); if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
}
const situacaoEst = it => (!it.ativo ? 'pausado' : Number(it.quantidade) <= 0 ? 'acabou' : Number(it.quantidade) <= Number(it.minimo) ? 'acabando' : 'ok');
const filtroEst = { situacao: 'todos', busca: '' };
let estoqueCache = [], consumosCache = [], produtosEst = null, estoqueAbrir = null;

async function telaEstoque(el) {
  el.innerHTML = cabecalho('Estoque', `<button type="button" class="btn primary" data-est-novo>${ic('mais')}Novo item</button>`,
      'Ingredientes, embalagens e bebidas. Quando um item chega no estoque mínimo, aparece um aviso no sino.') + `
    <div class="est-kpis" id="estKpis"></div>
    <div class="filtros">
      <div class="linha"><div class="busca">${ic('busca')}<label class="sr" for="estBusca">Buscar no estoque</label>
        <input class="in" id="estBusca" type="search" placeholder="Nome ou categoria" value="${esc(filtroEst.busca)}" autocomplete="off"></div></div>
      <div class="chips" role="group" aria-label="Filtrar">${[['todos', 'Todos'], ['acabando', 'Acabando'], ['acabou', 'Acabou'], ['ok', 'Em dia'], ['pausado', 'Sem aviso']]
        .map(([v, t]) => `<button type="button" class="chip" data-est-f="${v}" aria-pressed="${v === filtroEst.situacao}">${t}</button>`).join('')}</div>
    </div>
    <div id="estCorpo"><div class="skel" style="height:300px"></div></div>`;
  let t;
  $('#estBusca').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filtroEst.busca = e.target.value; desenharEstoque(); }, 200); });
  await carregarEstoque();
}
async function carregarEstoque() {
  const corpo = $('#estCorpo'); if (!corpo) return;
  try { [estoqueCache, consumosCache] = await Promise.all([api.admin.estoque.listar(), api.admin.estoque.consumos()]); }
  catch (e) {
    const semTabela = /estoque_itens|42P01|PGRST205|schema cache|does not exist|não existe/i.test(`${e?.message} ${e?.codigo}`);
    $('#estKpis').innerHTML = '';
    corpo.innerHTML = `<div class="vazio"><h2>${semTabela ? 'O estoque ainda não está no banco' : 'Não foi possível carregar'}</h2>
      <p>${semTabela ? 'Rode no Supabase o arquivo <code>sql/estoque.sql</code> (SQL Editor). Depois, é só voltar aqui.' : esc(e?.message || 'Tente de novo.')}</p></div>`;
    return;
  }
  desenharEstoque();
  badgeEstoque(estoqueCache);
  if (estoqueAbrir) { const id = estoqueAbrir; estoqueAbrir = null; abrirItemEstoque(id); }
}
function desenharEstoque() {
  const corpo = $('#estCorpo'); if (!corpo) return;
  const cont = { acabando: 0, acabou: 0 };
  estoqueCache.forEach(it => { const s = situacaoEst(it); if (s in cont) cont[s]++; });
  $('#estKpis').innerHTML = [['todos', estoqueCache.length, estoqueCache.length === 1 ? 'item no estoque' : 'itens no estoque', ''], ['acabando', cont.acabando, 'acabando', 'sinal'], ['acabou', cont.acabou, cont.acabou === 1 ? 'acabou' : 'acabaram', 'pend']]
    .map(([f, n, rot, cls]) => `<button type="button" class="est-kpi ${n && cls ? cls : ''}" data-est-f="${f}" aria-pressed="${filtroEst.situacao === f}"><strong>${n}</strong><span>${rot}</span></button>`).join('');
  if (!estoqueCache.length) {
    corpo.innerHTML = `<div class="card vazio"><h2>Nenhum item no estoque ainda</h2><p>Cadastre ingredientes, embalagens e bebidas com o estoque mínimo de cada um: quando chegar nele, aparece um aviso no sino.</p>
      <button type="button" class="btn primary" data-est-novo style="margin-top:14px">${ic('mais')}Cadastrar o primeiro item</button></div>`;
    return;
  }
  const termo = semAcento(filtroEst.busca.trim());
  const lista = estoqueCache.filter(it => (filtroEst.situacao === 'todos' || situacaoEst(it) === filtroEst.situacao) && (!termo || semAcento(`${it.nome} ${it.categoria || ''}`).includes(termo)));
  if (!lista.length) { corpo.innerHTML = '<div class="card"><p class="vazio">Nenhum item com esse filtro.</p></div>'; return; }
  // por categoria; dentro de cada uma, o que acabou e o que está acabando primeiro
  const ordem = { acabou: 0, acabando: 1, ok: 2, pausado: 3 }, grupos = new Map();
  lista.sort((a, b) => ordem[situacaoEst(a)] - ordem[situacaoEst(b)] || a.nome.localeCompare(b.nome, 'pt-BR'))
    .forEach(it => { const g = it.categoria || 'Sem categoria'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(it); });
  corpo.innerHTML = [...grupos].sort(([a], [b]) => (a === 'Sem categoria') - (b === 'Sem categoria') || a.localeCompare(b, 'pt-BR'))
    .map(([g, itens]) => `<section class="card tabela est-grupo" aria-label="${esc(g)}"><div class="est-cab"><h2>${esc(g)}</h2><span class="tag cinza">${itens.length}</span></div>
      <div>${itens.map(linhaEstoque).join('')}</div></section>`).join('');
}
function linhaEstoque(it) {
  const s = situacaoEst(it), [rot, cls] = SITUACAO_EST[s], ligados = consumosCache.filter(c => c.item_id === it.id).length;
  return `<div class="est-linha ${s}">
    <button type="button" class="est-nome" data-est-item="${esc(it.id)}"><strong>${esc(it.nome)}</strong>
      <small>Mínimo: ${esc(qtdEst(it.minimo, it.unidade))}${ligados ? ` · sai sozinho com ${ligados} ${ligados === 1 ? 'produto' : 'produtos'}` : ''}</small></button>
    <span class="est-qtd"><b>${esc(numEst(it.quantidade))}</b><small>${esc(unidadeEst(it.quantidade, it.unidade))}</small></span>
    <span class="tag ${cls}">${rot}</span>
    <span class="est-bts"><button type="button" class="btn icon sm ghost" data-est-mov="saida" data-id="${esc(it.id)}" aria-label="Saída de ${esc(it.nome)}" title="Saída">${ic('menos')}</button>
      <button type="button" class="btn icon sm ghost" data-est-mov="entrada" data-id="${esc(it.id)}" aria-label="Entrada de ${esc(it.nome)}" title="Entrada">${ic('mais')}</button></span>
  </div>`;
}
/** Contador no menu: itens acabando ou que acabaram. */
async function badgeEstoque(lista) {
  if (!isAdmin()) return;
  try { lista = lista || await api.admin.estoque.listar(); } catch (e) { return; }
  const n = lista.filter(it => ['acabando', 'acabou'].includes(situacaoEst(it))).length;
  $$('[data-badge-estoque]').forEach(b => { b.textContent = n > 99 ? '99+' : n; b.hidden = !n; b.title = `${n} ${n === 1 ? 'item acabando' : 'itens acabando'} no estoque`; });
}
document.addEventListener('click', e => {
  if (!perfil || !isAdmin()) return;
  const b = e.target.closest('[data-est-novo],[data-est-f],[data-est-item],[data-est-mov]');
  if (!b || b.closest('.modal-veu')) return;
  if (b.dataset.estNovo !== undefined) modalItemEstoque();
  else if (b.dataset.estF) { filtroEst.situacao = b.dataset.estF; $$('[data-est-f]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.estF === filtroEst.situacao))); desenharEstoque(); }
  else if (b.dataset.estItem) abrirItemEstoque(b.dataset.estItem);
  else if (b.dataset.estMov) { const it = estoqueCache.find(x => x.id === b.dataset.id); if (it) modalMovEstoque(it, b.dataset.estMov); }
});

/* ---- Entrada, saída ou contagem ---- */
function modalMovEstoque(it, tipo = 'entrada', depois) {
  const TIPOS = [['entrada', 'Entrada', 'Chegou: compra, produção'], ['saida', 'Saída', 'Usou, perdeu, venceu'], ['ajuste', 'Contagem', 'Contei: tem exatamente']];
  const m = abrirModal({
    titulo: it.nome,
    corpo: `<p class="est-atual">Agora: <b>${esc(qtdEst(it.quantidade, it.unidade))}</b> · mínimo ${esc(qtdEst(it.minimo, it.unidade))}</p>
      <div class="est-tipos" role="radiogroup" aria-label="O que aconteceu">${TIPOS.map(([v, t, d]) => `<label class="est-tipo"><input type="radio" name="mvTipo" value="${v}" ${v === tipo ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
      <div class="grid2">${campo('mvQtd', 'Quantidade', `<div class="est-un-in"><input class="in" id="mvQtd" inputmode="decimal" autocomplete="off" placeholder="0"><span>${esc(unidadeEst(2, it.unidade))}</span></div>`)}
        ${inTxt('mvMotivo', 'Motivo <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', '', { attrs: 'maxlength="120" placeholder="Ex.: compra no atacadista"' })}</div>
      <p class="ajuste-dica" id="mvPrev" aria-live="polite"></p>`,
    rodape: `<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>Salvar</button>`
  });
  const tipoSel = () => m.$('input[name="mvTipo"]:checked').value;
  const previa = () => {
    const q = lerQtd(valDe(m, 'mvQtd')), el = m.$('#mvPrev');
    if (q === null || Number.isNaN(q)) { el.textContent = tipoSel() === 'ajuste' ? 'Digite quanto tem agora, contando tudo.' : ''; return; }
    const fica = tipoSel() === 'entrada' ? Number(it.quantidade) + q : tipoSel() === 'saida' ? Number(it.quantidade) - q : q;
    el.textContent = `Fica: ${qtdEst(fica, it.unidade)}${fica <= 0 ? ' (acabou: vai avisar no sino)' : fica <= Number(it.minimo) ? ' (no mínimo: vai avisar no sino)' : ''}.`;
  };
  m.el.addEventListener('input', previa); m.el.addEventListener('change', previa); previa();
  setTimeout(() => m.$('#mvQtd')?.focus(), 60);
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    const q = lerQtd(valDe(m, 'mvQtd')), t = tipoSel();
    if (q === null || Number.isNaN(q) || q < 0 || (t !== 'ajuste' && q === 0)) { m.$('#mvQtd').setAttribute('aria-invalid', 'true'); m.$('#mvQtd').focus(); throw new Error('Informe a quantidade (ex.: 12 ou 2,5).'); }
    const r = await api.admin.estoque.movimentar(it.id, t, q, valDe(m, 'mvMotivo'));
    m.fechar();
    toast(`${it.nome}: agora ${qtdEst(r.quantidade, r.unidade)}.`);
    await carregarEstoque();
    badgeEstoque();
    depois?.();
  }));
}

/* ---- Ficha do item: quantidade, o que dá baixa sozinho e histórico ---- */
async function abrirItemEstoque(id) {
  let it = estoqueCache.find(x => x.id === id), movs;
  try {
    if (!it) { estoqueCache = await api.admin.estoque.listar(); it = estoqueCache.find(x => x.id === id); }
    if (!it) { toast('Esse item não existe mais no estoque.', { tipo: 'erro' }); return; }
    movs = await api.admin.estoque.movimentos(id, 80);
    produtosEst = produtosEst || await api.admin.produtos.listarCompleto().catch(() => []);
  } catch (e) { erroToast(e); return; }
  const s = situacaoEst(it), [rot, cls] = SITUACAO_EST[s];
  const ligados = consumosCache.filter(c => c.item_id === id).map(c => ({ ...c, p: produtosEst.find(p => p.id === c.produto_id) }));
  const m = abrirModal({
    titulo: it.nome, largo: true,
    corpo: `<div class="est-topo"><div class="est-grande"><b>${esc(numEst(it.quantidade))}</b><span>${esc(unidadeEst(it.quantidade, it.unidade))}</span></div>
        <div><span class="tag ${cls}">${rot}</span><p class="dica">Mínimo: ${esc(qtdEst(it.minimo, it.unidade))}${it.categoria ? ' · ' + esc(it.categoria) : ''}</p></div></div>
      <div class="est-acoes"><button type="button" class="btn teal" data-mv="entrada">${ic('mais')}Entrada</button><button type="button" class="btn ghost" data-mv="saida">${ic('menos')}Saída</button>
        <button type="button" class="btn ghost" data-mv="ajuste">${ic('ok')}Contagem</button></div>
      ${ligados.length ? `<p class="secao-t">Sai sozinho quando o pedido é confirmado</p><ul class="est-ligados">${ligados.map(c => `<li>${esc(c.p?.nome || 'Produto que saiu do cardápio')}: <b>${esc(qtdEst(c.quantidade, it.unidade))}</b> ${c.por_kg ? 'por kg' : 'cada'}</li>`).join('')}</ul>` : ''}
      ${it.observacao ? `<p class="secao-t">Observação</p><p class="est-obs">${esc(it.observacao)}</p>` : ''}
      <p class="secao-t">Histórico</p>
      ${movs.length ? `<ul class="est-hist">${movs.map(mv => {
        const q = Number(mv.quantidade), aj = mv.tipo === 'ajuste';
        return `<li class="${q >= 0 ? 'mais' : 'menos'}"><span class="est-h-q">${aj ? '= ' + esc(numEst(mv.saldo)) : (q > 0 ? '+' : '−') + esc(numEst(Math.abs(q)))}</span>
          <span class="est-h-t"><b>${TIPO_MOV_EST[mv.tipo] || esc(mv.tipo)}</b>${aj && q ? ` (${q > 0 ? '+' : '−'}${esc(numEst(Math.abs(q)))})` : ''}${mv.motivo ? ' · ' + (mv.pedido_id ? `<button type="button" class="link" data-mv-ped="${esc(mv.pedido_id)}">${esc(mv.motivo)}</button>` : esc(mv.motivo)) : ''}
          <small>${esc(dataHora(mv.criado_em))}${mv.autor_nome ? ' · ' + esc(mv.autor_nome) : ''} · ficou ${esc(qtdEst(mv.saldo, it.unidade))}</small></span></li>`;
      }).join('')}</ul>` : '<p class="est-obs" style="color:var(--ink-3)">Sem movimentos ainda.</p>'}`,
    rodape: `<button type="button" class="btn ghost" data-est-editar>${ic('editar')}Editar</button><button type="button" class="btn primary" data-fechar>Fechar</button>`
  });
  m.$$('[data-mv]').forEach(b => b.addEventListener('click', () => { m.fechar(); modalMovEstoque(it, b.dataset.mv, () => abrirItemEstoque(id)); }));
  m.$('[data-est-editar]').addEventListener('click', () => { m.fechar(); modalItemEstoque(it); });
  m.$$('[data-mv-ped]').forEach(b => b.addEventListener('click', () => { m.fechar(); verPedido(b.dataset.mvPed); }));
}

/* ---- Cadastro do item, com a baixa automática pelos produtos do cardápio ---- */
async function modalItemEstoque(it = null) {
  const novo = !it, d = it || { unidade: 'unidade', ativo: true };
  try { produtosEst = produtosEst || await api.admin.produtos.listarCompleto(); } catch (e) { produtosEst = []; }
  const grupos = new Map();
  produtosEst.forEach(p => { const g = p.categoria_nome || 'Outros'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(p); });
  const opcoes = sel => '<option value="">Escolha o produto</option>' + [...grupos].map(([g, ps]) => `<optgroup label="${esc(g)}">${ps.map(p =>
    `<option value="${esc(p.id)}" data-kg="${p.unidade_preco === 'kg' ? 1 : ''}" ${p.id === sel ? 'selected' : ''}>${esc(p.nome)}${p.ativo === false ? ' (fora do site)' : ''}</option>`).join('')}</optgroup>`).join('');
  const linhaConsumo = (c = {}) => `<div class="est-cons" data-cons>
      <select class="sel" data-cons-prod aria-label="Produto do cardápio">${opcoes(c.produto_id)}</select>
      <span class="est-cons-q"><span class="est-cons-g" aria-hidden="true">gasta</span><input class="in" data-cons-qtd inputmode="decimal" value="${esc(c.quantidade != null ? numEst(c.quantidade) : '1')}" aria-label="Quanto gasta"><span data-cons-un></span></span>
      <select class="sel" data-cons-base aria-label="Gasta por"><option value="un">cada bolo</option><option value="kg" ${c.por_kg ? 'selected' : ''}>por kg de bolo</option></select>
      <span class="est-cons-cada" data-cons-cada>cada um</span>
      <button type="button" class="btn icon sm ghost" data-cons-tirar aria-label="Tirar este produto">${ic('x')}</button></div>`;
  const cats = [...new Set([...CATEGORIAS_ESTOQUE, ...estoqueCache.map(x => x.categoria).filter(Boolean)])];
  const m = abrirModal({
    titulo: novo ? 'Novo item de estoque' : `Editar ${it.nome}`, largo: true,
    corpo: `<div class="grid2">${inTxt('eiNome', 'Nome', d.nome || '', { attrs: 'maxlength="80" placeholder="Ex.: Leite condensado"' })}${inTxt('eiCat', 'Categoria', d.categoria || '', { attrs: 'maxlength="40" list="eiCats" placeholder="Ex.: Ingredientes"' })}</div>
      <datalist id="eiCats">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <div class="grid3">${inSel('eiUn', 'Unidade', UNIDADES_ESTOQUE, d.unidade)}
        ${novo ? inTxt('eiQtd', 'Quanto tem agora', '', { attrs: 'inputmode="decimal" placeholder="0" autocomplete="off"' })
          : campo('eiQtdAgora', 'Quanto tem agora', `<input class="in" id="eiQtdAgora" value="${esc(qtdEst(d.quantidade, d.unidade))}" readonly>`, 'Muda por Entrada, Saída ou Contagem.')}
        ${inTxt('eiMin', 'Estoque mínimo', d.minimo != null ? numEst(d.minimo) : '', { attrs: 'inputmode="decimal" placeholder="Ex.: 10" autocomplete="off"', dica: 'Chegou nisso: aviso no sino.' })}</div>
      <p class="secao-t">Sai sozinho com os pedidos <span style="text-transform:none;letter-spacing:0;font-weight:400">(opcional)</span></p>
      <p class="ajuste-dica" style="margin-top:-4px">Ligue aos produtos do cardápio que gastam este item. Quando o pedido é confirmado, sai do estoque; se for cancelado, volta. Ex.: a Coca-Cola 2 L gasta 1 garrafa; o Kit Individual gasta 1 suco; cada kg de bolo gasta 0,5 lata.</p>
      <div id="eiCons">${(novo ? [] : consumosCache.filter(c => c.item_id === it.id)).map(linhaConsumo).join('')}</div>
      <button type="button" class="btn sm ghost" data-cons-mais style="margin-bottom:14px">${ic('mais')}Ligar a um produto</button>
      ${inTa('eiObs', 'Observação <span style="font-weight:400;color:var(--ink-3)">(opcional)</span>', d.observacao || '', { attrs: 'maxlength="500" style="min-height:60px" placeholder="Ex.: comprar no atacadista; marca X"' })}
      ${novo ? '' : inChk('eiAtivo', 'Avisar quando estiver acabando', d.ativo)}`,
    rodape: `${novo ? '' : `<button type="button" class="btn danger esq" data-del>${ic('lixo')}Excluir</button>`}<button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn primary" data-ok>${novo ? 'Cadastrar' : 'Salvar'}</button>`
  });
  // bolo vendido por peso: escolhe "cada bolo" ou "por kg"; os outros produtos gastam "cada um". A unidade segue a do item.
  const ajustarLinhas = () => m.$$('[data-cons]').forEach(l => {
    const kg = !!l.querySelector('[data-cons-prod]').selectedOptions[0]?.dataset.kg, base = l.querySelector('[data-cons-base]');
    base.hidden = !kg; l.querySelector('[data-cons-cada]').hidden = kg;
    if (!kg) base.value = 'un';
    l.querySelector('[data-cons-un]').textContent = unidadeEst(lerQtd(l.querySelector('[data-cons-qtd]').value) ?? 2, valDe(m, 'eiUn'));
  });
  ajustarLinhas();
  m.$('[data-cons-mais]').addEventListener('click', () => { m.$('#eiCons').insertAdjacentHTML('beforeend', linhaConsumo()); ajustarLinhas(); m.$$('[data-cons-prod]').at(-1).focus(); });
  m.$('#eiCons').addEventListener('click', e => { const b = e.target.closest('[data-cons-tirar]'); if (b) b.closest('[data-cons]').remove(); });
  m.el.addEventListener('change', e => { if (e.target.matches('[data-cons-prod], #eiUn')) ajustarLinhas(); });
  m.el.addEventListener('input', e => { if (e.target.matches('[data-cons-qtd]')) ajustarLinhas(); });
  m.$('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmar(`Excluir ${it.nome}?`, 'O item, o histórico e a ligação com os produtos serão apagados. Se só não quiser mais o aviso, desmarque “Avisar quando estiver acabando”.', { botao: 'Excluir', perigo: true })) return;
    await ocupado(m.$('[data-del]'), async () => { await api.admin.estoque.remover(it.id); m.fechar(); toast(`${it.nome} excluído do estoque.`); await carregarEstoque(); badgeEstoque(); });
  });
  m.$('[data-ok]').addEventListener('click', ev => ocupado(ev.currentTarget, async () => {
    exigir(m, 'eiNome', 'Informe o nome do item.');
    const minimo = lerQtd(valDe(m, 'eiMin'));
    if (minimo === null || Number.isNaN(minimo) || minimo < 0) { m.$('#eiMin').focus(); throw new Error('Informe o estoque mínimo (ex.: 10). Use 0 para avisar só quando acabar.'); }
    const qtd = novo ? lerQtd(valDe(m, 'eiQtd')) ?? 0 : null;
    if (novo && (Number.isNaN(qtd) || qtd < 0)) { m.$('#eiQtd').focus(); throw new Error('Confira quanto tem agora (ex.: 12 ou 2,5).'); }
    const consumos = [];
    for (const l of m.$$('[data-cons]')) {
      const produto_id = l.querySelector('[data-cons-prod]').value, q = lerQtd(l.querySelector('[data-cons-qtd]').value);
      if (!produto_id) continue;   // linha sem produto: ignora
      if (!(q > 0)) { l.querySelector('[data-cons-qtd]').focus(); throw new Error('Diga quanto cada produto gasta (maior que zero).'); }
      if (consumos.some(c => c.produto_id === produto_id)) throw new Error('Esse produto apareceu duas vezes na lista.');
      consumos.push({ produto_id, quantidade: q, por_kg: l.querySelector('[data-cons-base]').value === 'kg' });
    }
    const dados = { nome: valDe(m, 'eiNome'), categoria: valDe(m, 'eiCat') || null, unidade: valDe(m, 'eiUn'), minimo, observacao: valDe(m, 'eiObs') || null, ativo: novo ? true : chkDe(m, 'eiAtivo') };
    let r;
    if (novo) {
      r = await api.admin.estoque.criar({ ...dados, quantidade: 0 });
      if (qtd > 0) await api.admin.estoque.movimentar(r.id, 'ajuste', qtd, 'Quantidade inicial');   // fica no histórico
    } else r = await api.admin.estoque.atualizar(it.id, dados);
    await api.admin.estoque.salvarConsumos(r.id, consumos);
    m.fechar();
    toast(novo ? `${dados.nome} cadastrado no estoque.` : `${dados.nome} salvo.`);
    await carregarEstoque();
    badgeEstoque();
  }));
}

/* =========================================================
   AVISOS (sino da barra de cima), criados pelo banco (sql/topos.sql).
   Ex.: "O topo do pedido RB-01005 está pronto". Ficam até alguém da equipe marcar como visto.
========================================================= */
let avisos = [], pararAvisos = null;
function tempoAtras(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`;
  return dataHora(iso);
}
/** Recarrega a lista e o contador do sino. false: o banco ainda não tem os avisos (o sino fica escondido). */
async function carregarAvisos() {
  let ok = true;
  try { avisos = await api.admin.notificacoes.listar({ limite: 30 }); } catch (e) { avisos = []; ok = false; }
  const n = avisos.filter(a => !a.lida_em).length;
  $$('[data-badge-avisos]').forEach(b => { b.textContent = n > 9 ? '9+' : n; b.hidden = !n; });
  $$('[data-act="avisos"]').forEach(b => { b.hidden = !ok; b.setAttribute('aria-label', n ? `Avisos: ${n} ${n === 1 ? 'novo' : 'novos'}` : 'Avisos'); b.title = b.getAttribute('aria-label'); });
  desenharAvisos();
  return ok;
}
function ligarAvisos() {
  pararAvisos?.();
  pararAvisos = api.admin.notificacoes.aoMudar(({ tipo, aviso }) => {
    if (tipo === 'INSERT' && aviso?.id) {
      tocarAviso();
      toast(aviso.texto || aviso.titulo, { tipo: 'novo', acao: { rotulo: 'Ver', fn: () => abrirDoAviso(aviso) }, tempo: 15000 });
    }
    carregarAvisos();
    if (isAdmin()) badgeEstoque();   // aviso de estoque (ou um item reposto): o contador do menu muda
  });
}
function desenharAvisos() {
  const menu = $('#avisosMenu'); if (!menu) return;
  const novos = avisos.filter(a => !a.lida_em).length;
  menu.innerHTML = `<div class="av-cab"><p class="tema-menu-t">Avisos</p>${novos ? '<button type="button" class="link" data-avisos-todos>Marcar todos como vistos</button>' : ''}</div>
    ${avisos.length ? avisos.map(a => `<button type="button" class="aviso-it ${a.lida_em ? '' : 'novo'}" data-aviso="${esc(a.id)}">${ic(a.tipo === 'topo_pronto' ? 'topo' : /^estoque/.test(a.tipo) ? 'estoque' : 'sino')}
      <span><strong>${esc(a.titulo)}${a.lida_em ? '' : '<i class="av-ponto" aria-label="novo"></i>'}</strong><small>${esc(a.texto || '')}</small><em>${esc(tempoAtras(a.criado_em))}</em></span></button>`).join('')
      : `<p class="av-vazio">Nenhum aviso por enquanto. Quando um topo ficar pronto${isAdmin() ? ' ou um item do estoque estiver acabando' : ''}, ele aparece aqui.</p>`}`;
}
function abrirAvisos(botao) {
  if ($('#avisosMenu')) { fecharAvisos(true); return; }
  fecharMenuTema();
  const menu = document.createElement('div');
  menu.id = 'avisosMenu'; menu.className = 'tema-menu avisos-menu'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Avisos');
  document.body.appendChild(menu);
  desenharAvisos(); posicionarAvisos();
  botao.setAttribute('aria-expanded', 'true');
  (menu.querySelector('button') || menu).focus?.();
  carregarAvisos();
}
function posicionarAvisos() {
  const menu = $('#avisosMenu'), b = $('.topo [data-act="avisos"]'); if (!menu || !b) return;
  const r = b.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
}
function fecharAvisos(devolverFoco) {
  const menu = $('#avisosMenu'); if (!menu) return;
  menu.remove();
  const b = $('.topo [data-act="avisos"]'); b?.setAttribute('aria-expanded', 'false');
  if (devolverFoco) b?.focus();
}
/** Abre o que o aviso fala: o item do estoque, o pedido do bolo (ou a ficha do topo, se não tiver pedido ligado). */
function abrirDoAviso(a) {
  if (!a.lida_em) api.admin.notificacoes.marcarVista(a.id).then(carregarAvisos).catch(() => {});
  if (a.estoque_item_id && isAdmin()) {
    estoqueAbrir = a.estoque_item_id;
    if (telaAtual === 'estoque') carregarEstoque(); else location.hash = '#estoque';
  } else if (a.pedido_id) verPedido(a.pedido_id);
  else if (a.topo_id && podeTopos()) abrirTopo(a.topo_id);
}
document.addEventListener('click', async e => {
  if ($('#avisosMenu') && !e.target.closest('#avisosMenu, [data-act="avisos"]')) { fecharAvisos(); return; }
  if (e.target.closest('[data-avisos-todos]')) {
    await ocupado(e.target.closest('button'), async () => { await api.admin.notificacoes.marcarVista(); await carregarAvisos(); });
    return;
  }
  const it = e.target.closest('[data-aviso]'); if (!it) return;
  const a = avisos.find(x => String(x.id) === it.dataset.aviso); if (!a) return;
  fecharAvisos(); abrirDoAviso(a);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#avisosMenu')) { e.stopPropagation(); fecharAvisos(true); } }, true);
addEventListener('resize', posicionarAvisos);

iniciar();
