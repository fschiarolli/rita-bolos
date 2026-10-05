/* =========================================================
   AVATARES DA EQUIPE
   Personagens desenhados em SVG (estilo "brinquedo": cabeça
   arredondada com luz e sombra, fundo colorido). Cada pessoa
   escolhe o seu em Minha conta; o banco guarda só o código
   (ex.: "a07"). Para criar outro, acrescente uma linha em
   AVATARES com as peças abaixo.
========================================================= */

const PELES = { a: '#FADCC0', b: '#F1C094', c: '#D9976A', d: '#B97440', e: '#8A5230', f: '#5E3A24' };
const CABELOS = {
  preto: '#231815', castanho: '#4B2E1F', marrom: '#7A4A2A', loiro: '#E9B44C', ruivo: '#C2462B',
  grisalho: '#CFCAC4', azul: '#5EC8E8', rosa: '#F28AB8', roxo: '#9B6BE0'
};

/* f: fundo · p: pele · c: cabelo [estilo, cor] · r: roupa · x: acessórios ("peça" ou "peça:cor") */
export const AVATARES = [
  { id: 'a01', f: '#F2994A', p: 'd', c: ['curto', 'preto'], r: '#2F6FDE', x: ['bone:#3B5BDB'] },
  { id: 'a02', f: '#A3C93A', p: 'b', c: ['cacheado', 'ruivo'], r: '#2E9C6A', x: [] },
  { id: 'a03', f: '#EB5757', p: 'c', c: ['longo', 'castanho'], r: '#F2C94C', x: ['barba'] },
  { id: 'a04', f: '#27AE60', p: 'b', c: ['topete', 'ruivo'], r: '#E8505B', x: [] },
  { id: 'a05', f: '#F2994A', p: 'd', c: ['careca', 'preto'], r: '#3D5AFE', x: ['turbante:#F57C00', 'barba'] },
  { id: 'a06', f: '#E0A87E', p: 'e', c: ['longo', 'preto'], r: '#EB5757', x: [] },
  { id: 'a07', f: '#BB6BD9', p: 'b', c: ['franja', 'azul'], r: '#7E57C2', x: [] },
  { id: 'a08', f: '#F78FB3', p: 'c', c: ['curto', 'preto'], r: '#E91E63', x: ['boina:#C2185B'] },
  { id: 'a09', f: '#EF476F', p: 'd', c: ['longo', 'preto'], r: '#2E9C6A', x: ['oculos:#F28AB8'] },
  { id: 'a10', f: '#9B9BD4', p: 'd', c: ['careca', 'preto'], r: '#5C6BC0', x: ['oculos:#8E7CC3', 'brincos'] },
  { id: 'a11', f: '#F2994A', p: 'b', c: ['topete', 'marrom'], r: '#E8505B', x: ['barba'] },
  { id: 'a12', f: '#2E7D5B', p: 'c', c: ['longo', 'preto'], r: '#F2C94C', x: [] },
  { id: 'a13', f: '#5B8DEF', p: 'c', c: ['curto', 'preto'], r: '#2F54EB', x: [] },
  { id: 'a14', f: '#F2C94C', p: 'd', c: ['coque', 'preto'], r: '#F2994A', x: ['brincos'] },
  { id: 'a15', f: '#C6C3A0', p: 'c', c: ['careca', 'preto'], r: '#7A8F5A', x: ['cavanhaque'] },
  { id: 'a16', f: '#7E8CC9', p: 'e', c: ['cacheado', 'grisalho'], r: '#5C6BC0', x: [] },
  { id: 'a17', f: '#1F2A44', p: 'a', c: ['ondulado', 'loiro'], r: '#3F51B5', x: [] },
  { id: 'a18', f: '#2EC4B6', p: 'f', c: ['afro', 'preto'], r: '#26A69A', x: [] },
  { id: 'a19', f: '#F45B69', p: 'c', c: ['longo', 'preto'], r: '#EF5350', x: [] },
  { id: 'a20', f: '#B983A8', p: 'c', c: ['cacheado', 'castanho'], r: '#8E44AD', x: [] },
  { id: 'a21', f: '#F9C6D3', p: 'b', c: ['ondulado', 'grisalho'], r: '#F48FB1', x: ['oculos:#C9A15A'] },
  { id: 'a22', f: '#6C8EBF', p: 'd', c: ['moicano', 'preto'], r: '#3F51B5', x: ['barba'] },
  { id: 'a23', f: '#2D2D2D', p: 'a', c: ['curto', 'grisalho'], r: '#ECEFF1', x: ['chapeu:#3A3A3A', 'barba'] },
  { id: 'a24', f: '#F28AB8', p: 'c', c: ['longo', 'azul'], r: '#EC407A', x: [] },
  { id: 'a25', f: '#E8A33D', p: 'a', c: ['ondulado', 'loiro'], r: '#F2994A', x: [] },
  { id: 'a26', f: '#FFE7D1', p: 'd', c: ['curto', 'preto'], r: '#8D6E63', x: ['chapeu:#5D4037'] },
  { id: 'a27', f: '#D4D9A8', p: 'c', c: ['careca', 'preto'], r: '#9CCC65', x: ['cavanhaque', 'oculos:#2B2B2B'] },
  { id: 'a28', f: '#3949AB', p: 'e', c: ['careca', 'preto'], r: '#283593', x: ['hijab:#3D5AFE'] },
  { id: 'a29', f: '#8BC6B0', p: 'c', c: ['careca', 'preto'], r: '#4DB6AC', x: ['oculos:#2B2B2B', 'barba'] },
  { id: 'a30', f: '#2BB673', p: 'd', c: ['curto', 'preto'], r: '#43A047', x: ['gorro:#C0392B', 'barba'] },
  { id: 'a31', f: '#F2C94C', p: 'e', c: ['curto', 'preto'], r: '#FB8C00', x: ['barba'] },
  { id: 'a32', f: '#F06292', p: 'c', c: ['careca', 'preto'], r: '#D81B60', x: ['hijab:#E91E8C'] },
  { id: 'a33', f: '#D1A0F0', p: 'e', c: ['afro', 'roxo'], r: '#AB47BC', x: ['oculos:#2B2B2B'] },
  { id: 'a34', f: '#FFB74D', p: 'b', c: ['rabo', 'castanho'], r: '#FF7043', x: ['laco:#E53935'] },
  { id: 'a35', f: '#4DB6AC', p: 'f', c: ['coque', 'preto'], r: '#00897B', x: ['brincos'] },
  { id: 'a36', f: '#90CAF9', p: 'a', c: ['topete', 'loiro'], r: '#1E88E5', x: ['bigode'] }
];
const POR_ID = Object.fromEntries(AVATARES.map(a => [a.id, a]));
export const temAvatar = id => !!POR_ID[id];

/** Clareia (p > 0) ou escurece (p < 0) uma cor #rrggbb. */
function tom(hex, p) {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  return '#' + c.map(x => Math.round(p < 0 ? x * (1 + p) : x + (255 - x) * p)).map(x => x.toString(16).padStart(2, '0')).join('');
}

let seq = 0;
/** SVG do avatar (quadrado 120×120; o CSS recorta em círculo onde precisar). */
export function avatarSVG(id) {
  const a = POR_ID[id]; if (!a) return '';
  const u = `av${++seq}`;                     // ids únicos dos gradientes (vários avatares na mesma tela)
  const pele = PELES[a.p] || PELES.c, [estilo, corNome] = a.c, cab = CABELOS[corNome] || corNome;
  const ex = Object.fromEntries((a.x || []).map(s => { const [k, v] = s.split(':'); return [k, v || true]; }));
  const cobreCabeca = ex.hijab;
  const g = (nome, cor, claro = .22, escuro = -.18) => `<linearGradient id="${u}${nome}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tom(cor, claro)}"/><stop offset="1" stop-color="${tom(cor, escuro)}"/></linearGradient>`;
  const defs = `<defs>
    <radialGradient id="${u}luz" cx=".25" cy=".15" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}pele" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="${tom(pele, .2)}"/><stop offset=".55" stop-color="${pele}"/><stop offset="1" stop-color="${tom(pele, -.16)}"/></radialGradient>
    <radialGradient id="${u}nariz" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="${tom(pele, .12)}"/><stop offset="1" stop-color="${tom(pele, -.2)}"/></radialGradient>
    ${g('cab', cab, .25, -.25)}${g('roupa', a.r, .2, -.2)}${typeof ex.hijab === 'string' ? g('hij', ex.hijab, .2, -.22) : ''}
  </defs>`;
  const s = [];
  // fundo com luz de estúdio
  s.push(`<rect width="120" height="120" fill="${a.f}"/><rect width="120" height="120" fill="url(#${u}luz)"/>`);
  s.push(`<ellipse cx="60" cy="118" rx="44" ry="10" fill="#000" opacity=".12"/>`);
  // cabelo de trás (antes do corpo e da cabeça)
  if (!cobreCabeca) s.push(cabeloTras(estilo, u));
  // corpo e pescoço
  s.push(`<path d="M14 120C14 99 32 89 60 89s46 10 46 31z" fill="url(#${u}roupa)"/>`);
  s.push(`<path d="M51 70h18v18c0 5-4 8-9 8s-9-3-9-8z" fill="${tom(pele, -.14)}"/>`);
  s.push(`<path d="M47 90q13 11 26 0" fill="none" stroke="${tom(a.r, -.28)}" stroke-width="3" stroke-linecap="round"/>`);
  if (cobreCabeca) s.push(`<path d="M29 60C27 30 44 21 60 21s33 9 31 39c1 22 7 38 15 60H14c8-22 14-38 15-60z" fill="url(#${u}hij)"/>`);
  // orelhas e cabeça
  if (!cobreCabeca) {
    s.push(`<ellipse cx="37" cy="62" rx="5" ry="7" fill="${tom(pele, -.08)}"/><ellipse cx="83" cy="62" rx="5" ry="7" fill="${tom(pele, -.08)}"/>`);
    s.push(`<ellipse cx="37.5" cy="62" rx="2.2" ry="3.6" fill="${tom(pele, -.2)}"/><ellipse cx="82.5" cy="62" rx="2.2" ry="3.6" fill="${tom(pele, -.2)}"/>`);
  }
  s.push(`<ellipse cx="60" cy="58" rx="23.5" ry="26.5" fill="url(#${u}pele)"/>`);
  if (estilo === 'careca' && !cobreCabeca && !ex.bone && !ex.gorro && !ex.chapeu && !ex.boina && !ex.turbante)
    s.push(`<ellipse cx="52" cy="38" rx="9" ry="5" fill="#fff" opacity=".22" transform="rotate(-18 52 38)"/>`);
  // barba antes do rosto (a boca fica por cima)
  if (ex.barba) s.push(`<path d="M37 60c1 18 10 31 23 31s22-13 23-31c-3 8-8 13-14 15-3-3-15-3-18 0-6-2-11-7-14-15z" fill="url(#${u}cab)"/>`);
  if (ex.cavanhaque) s.push(`<path d="M54 80c2 7 10 7 12 0-3 2-9 2-12 0z" fill="${cab}"/>`);
  // rosto
  s.push(`<circle cx="46" cy="70" r="4.2" fill="#FF6B6B" opacity=".22"/><circle cx="74" cy="70" r="4.2" fill="#FF6B6B" opacity=".22"/>`);
  const sobr = ex.barba || cobreCabeca ? tom(cab, -.1) : cab;
  s.push(`<path d="M46.5 52.5q4-2.6 8 0M65.5 52.5q4-2.6 8 0" fill="none" stroke="${cobreCabeca ? '#2B1B14' : sobr}" stroke-width="2" stroke-linecap="round"/>`);
  s.push(`<ellipse cx="51" cy="60" rx="2.7" ry="3.5" fill="#2A1A14"/><ellipse cx="69" cy="60" rx="2.7" ry="3.5" fill="#2A1A14"/>`);
  s.push(`<circle cx="51.9" cy="58.8" r=".95" fill="#fff"/><circle cx="69.9" cy="58.8" r=".95" fill="#fff"/>`);
  s.push(`<ellipse cx="60" cy="67" rx="4.4" ry="3.8" fill="url(#${u}nariz)"/><ellipse cx="58.7" cy="65.6" rx="1.4" ry="1" fill="#fff" opacity=".35"/>`);
  if (ex.bigode || ex.cavanhaque) s.push(`<path d="M51 73c4-3 7-2.5 9-1 2-1.5 5-2 9 1-4 3.5-7 2.5-9 1.5-2 1-5 2-9-1.5z" fill="${cab}"/>`);
  s.push(`<path d="M54.5 75.5q5.5 4.2 11 0" fill="none" stroke="#7A2E2A" stroke-width="1.9" stroke-linecap="round"/>`);
  // cabelo da frente
  if (!cobreCabeca) s.push(cabeloFrente(estilo, u, cab, ex));
  // acessórios
  if (cobreCabeca) s.push(`<path fill-rule="evenodd" fill="url(#${u}hij)" d="M32 60C30 33 45 24 60 24s30 9 28 36c0 18-9 31-28 34-19-3-28-16-28-34zM60 34c-12 0-19 10-19 25s8 26 19 26 19-11 19-26-7-25-19-25z"/>
    <path d="M41 50c4-9 11-14 19-14" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>`);
  if (ex.oculos) {
    const c = typeof ex.oculos === 'string' ? ex.oculos : '#2B2B2B';
    s.push(`<g fill="#fff" fill-opacity=".14" stroke="${c}" stroke-width="2.3"><circle cx="51" cy="60" r="6.6"/><circle cx="69" cy="60" r="6.6"/></g>
      <path d="M57.6 59.5q2.4-2 4.8 0M44.4 59l-7-2M75.6 59l7-2" fill="none" stroke="${c}" stroke-width="2.1" stroke-linecap="round"/>`);
  }
  if (ex.brincos) s.push(`<circle cx="37" cy="71" r="2.5" fill="#F2C94C"/><circle cx="83" cy="71" r="2.5" fill="#F2C94C"/>`);
  if (ex.bone) {
    const c = ex.bone;
    s.push(`<path d="M35 50C33 29 46 20 60 20s27 9 25 30c-7-6-15-8-25-8s-18 2-25 8z" fill="${c}"/>
      <path d="M37 42C38 29 47 22 58 21" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-linecap="round"/>
      <path d="M34 48c9-7 43-7 52 0 3 4-6 6-26 6s-29-2-26-6z" fill="${tom(c, -.25)}"/><circle cx="60" cy="21" r="2.6" fill="${tom(c, -.2)}"/>`);
  }
  if (ex.gorro) {
    const c = ex.gorro;
    s.push(`<path d="M35 56C32 29 46 20 60 20s28 9 25 36z" fill="${c}"/>
      <path d="M44 26v24M52 22v26M60 21v26M68 22v26M76 26v24" stroke="${tom(c, -.18)}" stroke-width="2"/>
      <path d="M33 49c14-6 40-6 54 0v9c-14-5-40-5-54 0z" fill="${tom(c, -.22)}"/>`);
  }
  if (ex.chapeu) {
    const c = ex.chapeu;
    s.push(`<ellipse cx="60" cy="41" rx="39" ry="8.5" fill="${tom(c, -.15)}"/>
      <path d="M42 41c0-15 7-21 18-21s18 6 18 21c-10 3-26 3-36 0z" fill="${c}"/>
      <path d="M42.5 36c11 3 24 3 35 0v4c-11 3-24 3-35 0z" fill="${tom(c, .25)}"/>`);
  }
  if (ex.boina) {
    const c = ex.boina;
    s.push(`<path d="M33 48c0-15 15-22 30-20 17 2 27 10 24 20-12-4-41-4-54 0z" fill="${c}"/>
      <path d="M60 28l1-5" stroke="${tom(c, -.25)}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M38 40c5-6 14-9 22-9" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>`);
  }
  if (ex.turbante) {
    const c = ex.turbante;
    s.push(`<path d="M34 53C31 28 45 17 60 17s29 11 26 36c-8-6-16-9-26-9s-18 3-26 9z" fill="${c}"/>
      <path d="M37 44c8-12 20-18 36-14M38 34c10-8 22-11 38-6M48 24c8-3 16-3 26 1" fill="none" stroke="${tom(c, -.22)}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M60 31c4 0 7 4 6 8-1 3-4 5-6 5s-5-2-6-5c-1-4 2-8 6-8z" fill="${tom(c, .18)}"/>`);
  }
  if (ex.laco) {
    const c = ex.laco;
    s.push(`<path d="M74 27l-9-6v12zM74 27l9-6v12z" fill="${c}"/><circle cx="74" cy="27" r="2.6" fill="${tom(c, -.2)}"/>`);
  }
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${defs}${s.join('')}</svg>`;
}

/* Cabelo que fica atrás da cabeça (comprido, black power, coque, rabo) */
function cabeloTras(estilo, u) {
  const f = `fill="url(#${u}cab)"`;
  switch (estilo) {
    case 'longo': return `<path d="M33 58C30 31 45 24 60 24s30 7 27 34l4 38c-9 5-19 3-24-3H53c-5 6-15 8-24 3z" ${f}/>`;
    case 'ondulado': return `<path d="M33 58C30 31 45 24 60 24s30 7 27 34l2 22c2 4-1 8-5 7-1 4-6 5-9 2-3 3-8 2-9-2H52c-1 4-6 5-9 2-3 3-8 2-9-2-4 1-7-3-5-7z" ${f}/>`;
    case 'afro': return `<g ${f}><circle cx="60" cy="46" r="33"/>${[0, 40, 80, 120, 160, 200, 240, 280, 320].map(g => {
      const r = g * Math.PI / 180; return `<circle cx="${(60 + 31 * Math.cos(r)).toFixed(1)}" cy="${(46 + 29 * Math.sin(r)).toFixed(1)}" r="9"/>`; }).join('')}</g>`;
    case 'coque': return `<circle cx="60" cy="25" r="10.5" ${f}/>`;
    case 'rabo': return `<path d="M80 40c12 4 14 22 6 40-2-12-6-22-12-28z" ${f}/>`;
    default: return '';
  }
}

/* Cabelo da frente (franja, topete, cachos…) — chapéu/boné/gorro/turbante cobrem o alto da cabeça */
function cabeloFrente(estilo, u, cab, ex) {
  const f = `fill="url(#${u}cab)"`, chapeu = ex.bone || ex.gorro || ex.turbante || ex.boina;
  const brilho = d => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-linecap="round"/>`;
  switch (estilo) {
    case 'careca': return '';
    case 'curto':
      return chapeu ? `<path d="M37.2 59c-.6-4 0-7.5 1.6-10.5l2.6.6c-1.2 2.8-1.6 6-1.3 9.4zM82.8 59c.6-4 0-7.5-1.6-10.5l-2.6.6c1.2 2.8 1.6 6 1.3 9.4z" ${f}/>`
        : `<path d="M36 60C33 38 45 28 60 28s27 10 24 32c-2-10-6-16-12-18-6 4-16 5-26 2-5 3-8 8-10 16z" ${f}/>${brilho('M44 36c5-4 11-5 17-5')}`;
    case 'topete':
      return `<path d="M36 60C33 38 45 28 60 28s27 10 24 32c-2-10-6-16-12-18-6 4-16 5-26 2-5 3-8 8-10 16z" ${f}/>
        <path d="M45 37c3-14 24-18 33-6-8-3-18-1-25 7z" ${f}/>${brilho('M50 30c6-5 14-6 21-3')}`;
    case 'moicano':
      return `<path d="M54 42c-2-14 2-26 6-30 5 5 8 16 6 30-4-2-8-2-12 0z" ${f}/><path d="M36 58c0-6 1-10 3-13M84 58c0-6-1-10-3-13" stroke="${tom(cab, .1)}" stroke-width="3" stroke-linecap="round" opacity=".55"/>`;
    case 'cacheado': case 'afro': {
      const bolas = [];
      for (let i = 0; i <= 10; i++) {
        const ang = Math.PI * (1.02 + i * 0.096);
        bolas.push(`<circle cx="${(60 + 25 * Math.cos(ang)).toFixed(1)}" cy="${(53 + 24 * Math.sin(ang)).toFixed(1)}" r="${estilo === 'afro' ? 6.5 : 7.5}"/>`);
      }
      return `<g ${f}><ellipse cx="60" cy="38" rx="22" ry="12"/>${bolas.join('')}</g>${brilho('M46 33c5-4 11-5 17-4')}`;
    }
    case 'longo': case 'ondulado':
      return `<path d="M36 64C32 37 45 27 60 27s29 9 24 37c-3-12-9-21-21-23-5 7-15 12-27 23z" ${f}/>${brilho('M45 36c5-4 11-5 17-4')}`;
    case 'franja':
      return `<path d="M33 70C29 38 44 27 60 27s31 11 27 43l-5-2c1-9 0-16-2-21-10 3-30 3-40 0-2 5-3 12-2 21z" ${f}/>${brilho('M44 35c6-4 12-5 18-4')}`;
    case 'coque': case 'rabo':
      return `<path d="M36 58C34 38 46 29 60 29s26 9 24 29c-3-9-8-15-14-16-5 3-15 3-20 0-6 2-11 7-14 16z" ${f}/>${brilho('M45 36c5-4 11-5 17-4')}`;
    default: return '';
  }
}
