/**
 * Calendário para escolher uma data (site e backoffice)
 * ------------------------------------------------------------------
 * Mostra um mês por vez, com setas para ir aos meses seguintes. Os dias antes
 * de `min` ou depois de `max` ficam apagados e não podem ser escolhidos.
 * Funciona no toque e no teclado: setas (dia e semana), Page Up / Page Down
 * (mês), Home / End (começo e fim da semana), Enter ou espaço para escolher.
 *
 *   import { montarCalendario } from './js/calendario.js';
 *   const cal = montarCalendario(caixa, { valor: '2026-10-14', min: '2026-10-12', max: '2027-10-12',
 *                                        aoEscolher: iso => console.log(iso) });
 *   cal.definir('2026-11-02');            // muda a data escolhida (sem chamar aoEscolher)
 *   cal.limites('2026-10-15', null);      // muda os limites
 *
 * O visual fica com cada página (classes cal-*): o site e o backoffice têm o seu.
 */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const INICIAIS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const SETA = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

const valido = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const partes = s => { const [a, m, d] = String(s).split('-').map(Number); return { a, m: m - 1, d }; };
const montar = (a, m, d) => new Date(Date.UTC(a, m, d)).toISOString().slice(0, 10);
const somarDias = (s, n) => { const { a, m, d } = partes(s); return montar(a, m, d + n); };
const diaDaSemana = s => { const { a, m, d } = partes(s); return new Date(Date.UTC(a, m, d)).getUTCDay(); };
const diasNoMes = (a, m) => new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
/** O mesmo dia, n meses depois (31/01 + 1 mês = 28 ou 29/02). */
function somarMeses(s, n) {
  const { a, m, d } = partes(s), alvo = new Date(Date.UTC(a, m + n, 1));
  return montar(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(d, diasNoMes(alvo.getUTCFullYear(), alvo.getUTCMonth())));
}
/** Hoje (AAAA-MM-DD) no fuso da loja. */
export const hojeNaLoja = (fuso = 'America/Sao_Paulo') => new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());
/** "quarta-feira, 14 de outubro de 2026" */
export const dataPorExtenso = s => (valido(s) ? `${SEMANA[diaDaSemana(s)]}, ${partes(s).d} de ${MESES[partes(s).m]} de ${partes(s).a}` : '');

/**
 * Monta o calendário dentro de `el`.
 * opções: valor (AAAA-MM-DD escolhido), min, max, hoje (para marcar o dia de hoje),
 *         aoEscolher(iso), rotulo (nome do grupo para leitores de tela).
 */
export function montarCalendario(el, opcoes = {}) {
  const hoje = valido(opcoes.hoje) ? opcoes.hoje : hojeNaLoja();
  const aoEscolher = opcoes.aoEscolher || (() => {});
  let valor = valido(opcoes.valor) ? opcoes.valor : null;
  let min = valido(opcoes.min) ? opcoes.min : null, max = valido(opcoes.max) ? opcoes.max : null;
  const noLimite = s => (min && s < min ? min : max && s > max ? max : s);
  const fora = s => (min && s < min) || (max && s > max);
  // o mês que aparece: o da data escolhida; sem ela (ou com ela fora dos limites), o do dia mais perto que dá para escolher
  let mostrado = noLimite(valor || hoje), foco = mostrado;
  el.classList.add('cal');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', opcoes.rotulo || 'Escolha o dia');

  function desenhar(focar = null) {
    const { a, m } = partes(mostrado), primeiro = montar(a, m, 1);
    if (partes(foco).a !== a || partes(foco).m !== m || fora(foco)) {
      const cand = [valor, hoje, min].find(s => s && partes(s).a === a && partes(s).m === m && !fora(s));
      foco = cand || noLimite(primeiro);
    }
    const antes = !min || montar(a, m, 0) >= min, depois = !max || montar(a, m + 1, 1) <= max;
    const celulas = Array.from({ length: diaDaSemana(primeiro) }, () => '<span class="cal-vazio" aria-hidden="true"></span>');
    for (let d = 1; d <= diasNoMes(a, m); d++) {
      const s = montar(a, m, d), off = fora(s), sel = s === valor, ehHoje = s === hoje;
      celulas.push(`<button type="button" class="cal-dia${sel ? ' cal-sel' : ''}${ehHoje ? ' cal-hoje' : ''}" data-cal-dia="${s}"
        tabindex="${s === foco ? 0 : -1}" aria-pressed="${sel}" aria-label="${dataPorExtenso(s)}${ehHoje ? ', hoje' : ''}${off ? ', indisponível' : ''}" ${off ? 'disabled' : ''}>${d}</button>`);
    }
    el.innerHTML = `<div class="cal-cab">
        <button type="button" class="cal-nav" data-cal-mes="-1" aria-label="Mês anterior" ${antes ? '' : 'disabled'}>${SETA('M15 18l-6-6 6-6')}</button>
        <span class="cal-mes" aria-live="polite">${MESES[m].charAt(0).toUpperCase() + MESES[m].slice(1)} de ${a}</span>
        <button type="button" class="cal-nav" data-cal-mes="1" aria-label="Próximo mês" ${depois ? '' : 'disabled'}>${SETA('M9 18l6-6-6-6')}</button>
      </div>
      <div class="cal-sem" aria-hidden="true">${INICIAIS.map(x => `<span>${x}</span>`).join('')}</div>
      <div class="cal-grade">${celulas.join('')}</div>`;
    if (focar === 'dia') el.querySelector('.cal-dia[tabindex="0"]')?.focus();
    else if (focar) el.querySelector(`[data-cal-mes="${focar}"]`)?.focus();
  }
  function mudarMes(n, focar) {
    const { a, m } = partes(mostrado);
    mostrado = montar(a, m + n, 1);
    desenhar(focar);
    if (focar && el.querySelector(`[data-cal-mes="${focar}"]`)?.disabled) el.querySelector('.cal-dia[tabindex="0"]')?.focus();
  }
  function irPara(s) {
    s = noLimite(s);
    foco = s;
    if (partes(s).a !== partes(mostrado).a || partes(s).m !== partes(mostrado).m) mostrado = montar(partes(s).a, partes(s).m, 1);
    desenhar('dia');
  }
  el.addEventListener('click', e => {
    const nav = e.target.closest('[data-cal-mes]');
    if (nav && !nav.disabled) { mudarMes(Number(nav.dataset.calMes), nav.dataset.calMes); return; }
    const dia = e.target.closest('[data-cal-dia]');
    if (!dia || dia.disabled) return;
    valor = foco = dia.dataset.calDia;
    desenhar('dia');
    aoEscolher(valor);
  });
  el.addEventListener('keydown', e => {
    const dia = e.target.closest('[data-cal-dia]'); if (!dia) return;
    const s = dia.dataset.calDia, passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let alvo = null;
    if (e.key in passos) alvo = somarDias(s, passos[e.key]);
    else if (e.key === 'PageUp') alvo = somarMeses(s, -1);
    else if (e.key === 'PageDown') alvo = somarMeses(s, 1);
    else if (e.key === 'Home') alvo = somarDias(s, -diaDaSemana(s));
    else if (e.key === 'End') alvo = somarDias(s, 6 - diaDaSemana(s));
    if (!alvo) return;
    e.preventDefault();
    irPara(alvo);
  });
  desenhar();
  return {
    /** Muda a data escolhida (e mostra o mês dela), sem chamar aoEscolher. */
    definir(s) {
      valor = valido(s) ? s : null;
      if (valor) { foco = noLimite(valor); mostrado = montar(partes(foco).a, partes(foco).m, 1); }
      desenhar();
    },
    /** Muda o primeiro e o último dia que dá para escolher. */
    limites(novoMin, novoMax) {
      min = valido(novoMin) ? novoMin : null; max = valido(novoMax) ? novoMax : null;
      if (!valor) mostrado = noLimite(mostrado);
      desenhar();
    },
    /** Coloca o foco no dia escolhido (ou no primeiro que dá para escolher). */
    focar() { el.querySelector('.cal-dia[tabindex="0"]')?.focus(); },
    get valor() { return valor; }
  };
}
