/**
 * API da Rita Bolos
 * ------------------------------------------------------------------
 * Um único módulo usado pelo site (cardápio e pedidos) e pelo
 * backoffice (cadastros e gestão de pedidos). Fala com o Supabase:
 *   - banco (tabelas, vistas e funções RPC criadas nos scripts SQL)
 *   - autenticação (login da equipe)
 *   - storage (fotos do cardápio, bucket "cardapio"; imagens dos stories, bucket "stories")
 *
 * Uso no navegador:
 *   import { conectar } from './js/rita-api.js';
 *   import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './js/config.js';
 *   const api = await conectar(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
 *   const cardapio = await api.cardapio.obter();
 *
 * Todas as funções devolvem Promises e, em caso de problema, lançam
 * ErroApi com uma mensagem em português pronta para mostrar na tela.
 */

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ================================================================
   Erros
================================================================ */
export class ErroApi extends Error {
  constructor(erro, contexto) {
    super(mensagemAmigavel(erro));
    this.name = 'ErroApi';
    this.codigo = erro?.code ?? null;
    this.detalhes = erro?.details ?? null;
    this.contexto = contexto ?? null;
    this.original = erro;
  }
}

function mensagemAmigavel(e) {
  if (!e) return 'Erro inesperado.';
  const msg = String(e.message || '');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (/jwt expired|invalid jwt/i.test(msg) || e.code === 'PGRST301') return 'Sua sessão expirou. Entre novamente.';
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para isso. Entre com uma conta da equipe.';
  if (e.code === '23505') return 'Já existe um cadastro com esse mesmo identificador (nome ou código repetido).';
  if (e.code === '23503') return 'Este registro está em uso em outro cadastro e não pode ser removido. Você pode desativá-lo.';
  if (e.code === '23514') return 'Algum campo tem um valor fora do permitido. Confira os dados.';
  if (e.code === 'PGRST202' || /could not find the function/i.test(msg)) return 'Esta função ainda não existe no banco. Rode o script SQL mais recente no Supabase.';
  if (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table/i.test(msg)) return 'Esta parte ainda não existe no banco. Rode o script SQL mais recente no Supabase.';
  return msg || 'Erro inesperado.';
}

function conferir({ data, error }, contexto) {
  if (error) throw new ErroApi(error, contexto);
  return data;
}

/* ================================================================
   Utilidades (também exportadas para o site)
================================================================ */

/**
 * Pix para o pagamento do sinal: aparece no fim do pedido, nas mensagens do WhatsApp, no recibo e na impressão.
 * Vem de Ajustes > Loja (campos pix_* das configurações, sql/ajustes-loja.sql). PIX é o Pix de antes,
 * usado só enquanto o banco não tem esses campos.
 */
export const PIX = { chave: '06954518808', tipo: 'CPF', nome: 'Valdemir Schiarolli' };
/** Pix das configurações: { chave, tipo, nome }, ou null (chave em branco, ou configurações que não carregaram). */
export function pixDe(cfg) {
  if (!cfg) return null;   // sem as configurações, melhor não mostrar um Pix que pode estar desatualizado
  if (!('pix_chave' in cfg)) return PIX;
  const chave = String(cfg.pix_chave ?? '').trim();
  return chave ? { chave, tipo: String(cfg.pix_tipo ?? '').trim(), nome: String(cfg.pix_nome ?? '').trim() } : null;
}
/** Pix nas mensagens do WhatsApp ('' sem Pix). */
export const textoPix = pix => pix ? `*Pix${pix.tipo ? ` (${pix.tipo})` : ''}:* ${pix.chave}${pix.nome ? `\n*Nome:* ${pix.nome}` : ''}` : '';

/**
 * Imagem de referência (ex.: modelo do topper) enviada pelo cliente: vai na observação do item,
 * numa linha "Referência: <link>". Assim chega junto com o pedido em todo lugar (WhatsApp, recibo).
 */
const RE_REFERENCIA = /(?:^|\n)\s*Refer[êe]ncia:\s*(\S+)\s*$/im;
export const juntarReferencia = (obs, url) => [String(obs || '').trim(), url ? `Referência: ${url}` : ''].filter(Boolean).join('\n') || null;
/** Separa a observação do link da imagem: { texto, imagem }. */
export function separarReferencia(obs) {
  const s = String(obs || ''), m = s.match(RE_REFERENCIA);
  return m ? { texto: s.replace(RE_REFERENCIA, '').trim(), imagem: m[1] } : { texto: s.trim(), imagem: null };
}
/** Topper / topo de bolo (pede imagem de referência): pelo slug, nome ou grupo. */
export const ehTopper = (...textos) => textos.some(t => /topper|^topos?\b|topo de bolo|topos de bolo/i.test(String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')));

/**
 * Kits: o que vem dentro está na descrição do produto (Cardápio). O pedido guarda só o nome do kit,
 * então a equipe vê o conteúdo por aqui. produtos: lista do cadastro (vw_produtos) ou do cardápio
 * (achatarCardapio). Devolve um mapa usado por conteudoKit.
 */
export function mapaKits(produtos) {
  const m = new Map();
  for (const p of produtos || []) {
    const kit = p.unidade_preco === 'kit' || /kit/i.test(p.categoria_slug || '') || p.categoria_layout === 'grade';
    const txt = String(p.descricao || '').trim();
    if (!kit || !txt) continue;
    if (p.id) m.set(p.id, txt);
    m.set('nome:' + String(p.nome || '').trim().toLowerCase(), txt);
  }
  return m;
}
/** Produtos do cardápio público (obter_cardapio) numa lista só, com a categoria de cada um. */
export const achatarCardapio = c => (c?.categorias || []).flatMap(cat => [...(cat.grupos || []).flatMap(g => g.produtos || []), ...(cat.produtos || [])]
  .map(p => ({ ...p, categoria_slug: cat.slug, categoria_layout: cat.layout })));
/** O que vem no kit deste item do pedido (pelo produto; se não achar, pelo nome), ou null. */
export const conteudoKit = (item, mapa) => mapa?.get(item?.produto_id) || mapa?.get('nome:' + String(item?.nome || '').trim().toLowerCase()) || null;

export function formatarPreco(valor) {
  const n = Number(valor || 0);
  return 'R$\u00a0' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatarPeso(kg) {
  if (kg === null || kg === undefined || kg === '') return '';
  const n = Number(kg);
  return (Number.isInteger(n) ? String(n) : String(n).replace('.', ',')) + ' kg';
}

export function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function novaChave() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Celular ou tablet (inclui iPad, que se apresenta como Mac). */
export const ehCelular = () => typeof navigator !== 'undefined'
  && (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(navigator.userAgent || '') || (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1));

/**
 * Link para conversar no WhatsApp com a mensagem pronta.
 * Não usa o wa.me: ele passa pelo site whatsapp.com, que às vezes fica fora do ar
 * ("Sorry, something went wrong") mesmo com o WhatsApp funcionando.
 * Celular: abre direto o aplicativo. Computador: abre o WhatsApp Web.
 */
export function linkWhatsApp(numero, texto) {
  const n = String(numero || '').replace(/\D/g, ''), t = texto ? `&text=${encodeURIComponent(texto)}` : '';
  return ehCelular() ? `whatsapp://send?phone=${n}${t}` : `https://web.whatsapp.com/send?phone=${n}${t}`;
}
/** Abre o link do WhatsApp: o aplicativo na própria aba (sem deixar aba vazia); o WhatsApp Web numa aba nova. */
export function abrirWhatsApp(url) {
  if (/^whatsapp:/i.test(url)) location.href = url;
  else window.open(url, '_blank', 'noopener');
}
/** Atributos de um <a> para o link do WhatsApp (aba nova só para o WhatsApp Web). */
export const alvoWhatsApp = url => /^whatsapp:/i.test(url) ? '' : 'target="_blank" rel="noopener"';
/** Link da imagem que pode ir numa mensagem (no modo demonstração a imagem é um "data:" enorme, que quebra o link). */
export const linkCompartilhavel = url => /^https?:\/\//i.test(String(url || '')) ? url : '(imagem anexada no pedido)';

/** Endereço do recibo imprimível (recibo.html na raiz do site). */
export function linkRecibo(token, baseSite) {
  const base = (baseSite || (typeof location !== 'undefined' ? location.href : '')).replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  return `${base}recibo.html?t=${encodeURIComponent(token)}`;
}

/** Mensagem do WhatsApp montada a partir do pedido gravado (preços do servidor). cfg: configurações da loja (para o Pix). */
export function montarMensagemWhatsApp(pedido, urlRecibo, cfg) {
  const p = pedido, pix = textoPix(pixDe(cfg));
  const loja = (p.loja?.nome || 'Rita Bolos').toUpperCase();
  const pct = Number(p.percentual_sinal ?? 50).toLocaleString('pt-BR');
  const l = [
    `*NOVO PEDIDO — ${loja}*`,
    `_Pedido nº ${p.codigo}_`,
    '',
    `*Cliente:* ${p.cliente_nome}`,
    `*Retirada:* ${formatarData(p.data_retirada)}${p.hora_retirada ? ' às ' + p.hora_retirada : ''}`,
    '',
    '*Itens do pedido:*'
  ];
  (p.itens || []).forEach((i, n) => {
    l.push('', `${n + 1}. *${i.nome}${i.peso_kg ? ` (${formatarPeso(i.peso_kg)})` : ''}*`);
    if (i.massa) l.push(`   _Massa:_ ${i.massa}`);
    if (i.formato) l.push(`   _Formato:_ ${i.formato}`);
    if (i.segundo_recheio) l.push(`   _2º recheio:_ ${i.segundo_recheio}`);
    l.push(`   Qtd: ${i.quantidade} x ${formatarPreco(i.preco_unitario)} = ${formatarPreco(i.subtotal)}`);
    const { texto, imagem } = separarReferencia(i.observacao);
    if (texto) l.push(`   _Obs:_ ${texto}`);
    if (imagem) l.push(`   _Imagem de referência:_ ${linkCompartilhavel(imagem)}`);
  });
  if (p.observacao_cliente) l.push('', `*Observação:* ${p.observacao_cliente}`);
  l.push('', '----------------------------',
    `*Total:* ${formatarPreco(p.total)}`,
    `*Sinal mínimo (${pct}%):* ${formatarPreco(p.valor_sinal)}`,
    ...(pix ? ['', pix] : []),
    '',
    `*ATENÇÃO:* Pedido só será confirmado mediante envio do comprovante de pagamento de pelo menos ${pct}% do valor total.`);
  if (urlRecibo) l.push('', '----------------------------', '*RECIBO DO PEDIDO:*', urlRecibo);
  return l.join('\n').replace(/\u00a0/g, ' ');
}

/**
 * Mensagem para o cliente quando o pedido muda de status (a equipe confere antes de enviar).
 * status: { codigo, nome, descricao, finalizado } do cadastro. Os c\u00f3digos padr\u00e3o t\u00eam texto
 * pr\u00f3prio; status criados no backoffice usam o nome e a descri\u00e7\u00e3o cadastrados.
 * cfg: configura\u00e7\u00f5es da loja (para o Pix).
 */
export function montarMensagemStatus(pedido, status, urlRecibo, cfg) {
  const p = pedido, s = status || {}, pix = textoPix(pixDe(cfg));
  const e = p.entrega || null, rec = e ? quemRecebe(p) : null;
  // "Saiu para entrega" vai para quem recebe; se for outra pessoa (um presente), sem valores nem o link do recibo
  const paraOutro = s.codigo === 'em_rota' && !!rec?.outraPessoa;
  const nome = String((s.codigo === 'em_rota' && rec ? rec.nome : p.cliente_nome) || '').trim().split(/\s+/)[0];
  const ped = `*${p.codigo}*`;
  const quando = `${formatarData(p.data_retirada)}${p.hora_retirada ? ' \u00e0s ' + String(p.hora_retirada).slice(0, 5) : ''}`;
  const retirada = e ? `*Entrega:* ${quando}` : `*Retirada:* ${quando}`;
  const endereco = e ? `*Endere\u00e7o:* ${textoEndereco(e)}` : '';
  const saldo = Number(p.saldo ?? 0);
  const pct = Number(p.percentual_sinal ?? 50).toLocaleString('pt-BR');
  const textos = {
    recebido: [`Recebemos o seu pedido ${ped}.`, `Para confirmar, envie o comprovante do sinal de ${formatarPreco(p.valor_sinal)} (${pct}% ${e && Number(e.taxa) > 0 ? 'dos produtos' : 'do total'}).`, pix ? `\n${pix}` : ''],
    confirmado: [`Seu pedido ${ped} est\u00e1 *confirmado*! Recebemos o sinal.`, retirada, endereco],
    em_producao: [`Seu pedido ${ped} j\u00e1 est\u00e1 *em produ\u00e7\u00e3o*.`, retirada],
    pronto: e
      ? [`Seu pedido ${ped} est\u00e1 *pronto* e logo sai para entrega!`, retirada, saldo > 0 ? `*Falta pagar na entrega:* ${formatarPreco(saldo)}` : 'Est\u00e1 tudo pago.']
      : [`Seu pedido ${ped} est\u00e1 *pronto para retirada*!`, retirada, saldo > 0 ? `*Falta pagar:* ${formatarPreco(saldo)}` : 'Est\u00e1 tudo pago, \u00e9 s\u00f3 vir buscar.'],
    em_rota: paraOutro
      ? ['Um pedido para voc\u00ea *saiu para entrega* e j\u00e1 est\u00e1 a caminho!', endereco, 'Qualquer coisa, \u00e9 s\u00f3 responder esta mensagem.']
      : [`Seu pedido ${ped} *saiu para entrega* e j\u00e1 est\u00e1 a caminho!`, endereco, saldo > 0 ? `*Falta pagar na entrega:* ${formatarPreco(saldo)}` : 'Est\u00e1 tudo pago, \u00e9 s\u00f3 receber.'],
    retirado: [`Pedido ${ped} retirado. Agradecemos a prefer\u00eancia e bom apetite!`],
    entregue: [`Pedido ${ped} entregue. Agradecemos a prefer\u00eancia e bom apetite!`],
    cancelado: [`Seu pedido ${ped} foi *cancelado*.`, 'Se tiver alguma d\u00favida, \u00e9 s\u00f3 responder esta mensagem.']
  };
  const corpo = textos[s.codigo] || [`Seu pedido ${ped} mudou para *${s.nome || s.codigo}*.`, s.descricao, s.finalizado ? '' : retirada];
  const l = [`Ol\u00e1${nome ? ', ' + nome : ''}! Aqui \u00e9 da ${p.loja?.nome || 'Rita Bolos'}.`, '', ...corpo.filter(Boolean)];
  if (urlRecibo && !paraOutro && !['retirado', 'entregue', 'cancelado'].includes(s.codigo)) l.push('', `Acompanhe o pedido: ${urlRecibo}`);
  return l.join('\n').replace(/\u00a0/g, ' ');
}

/**
 * O navegador s\u00f3 deixa abrir aba nova no momento do clique. Como o WhatsApp s\u00f3
 * deve abrir depois de gravar no banco (depois de um await), a aba \u00e9 aberta j\u00e1
 * no clique e recebe o endere\u00e7o no fim: aba.ir(url), ou aba.fechar() se der erro.
 * aba.ir devolve false quando o navegador bloqueou a aba.
 */
export function prepararAba() {
  // no celular o WhatsApp é o aplicativo: abre da própria página (uma aba vazia ficaria para trás)
  if (ehCelular()) return { ir(url) { if (!/^whatsapp:/i.test(url)) return false; location.href = url; return true; }, fechar() {} };
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (w) {
    try {
      w.opener = null;
      w.document.title = 'Abrindo o WhatsApp\u2026';
      w.document.body.innerHTML = '<p style="font:16px/1.5 system-ui,sans-serif;padding:24px;color:#555">Abrindo o WhatsApp\u2026</p>';
    } catch (e) { /* s\u00f3 o aviso de carregando */ }
  }
  return {
    ir(url) {
      if (!w || w.closed) return false;
      w.location.href = url;
      return true;
    },
    fechar() { try { if (w && !w.closed) w.close(); } catch (e) { /* j\u00e1 fechada */ } }
  };
}

/* ================================================================
   Entregas (sql/entregas.sql)
   Endereço, links para o Waze e o Google Maps e a taxa pela distância.
   CEP: ViaCEP (ou BrasilAPI). Endereço no mapa: OpenStreetMap (Nominatim).
   Caminho de carro: OSRM. Todos gratuitos e sem chave; o OpenStreetMap
   pede no máximo uma busca por segundo, e as buscas daqui respeitam isso.
================================================================ */
/** CEP com hífen (13024-000). */
export const formatarCep = cep => { const d = String(cep ?? '').replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
/**
 * Endereço numa linha: "Rua X, 123 · Apto 4 · Cambuí · Campinas - SP".
 * paraMapa: só rua, bairro e cidade, com vírgulas (o complemento atrapalha a busca no mapa).
 */
export function textoEndereco(e, { paraMapa = false } = {}) {
  if (!e) return '';
  const partes = paraMapa ? [e.endereco, e.bairro, e.cidade] : [e.endereco, e.complemento, e.bairro, e.cidade];
  return partes.map(x => String(x ?? '').trim()).filter(Boolean).join(paraMapa ? ', ' : ' · ');
}
/** Waze com a rota até o endereço: no celular abre o aplicativo já navegando. */
export const linkWaze = e => `https://waze.com/ul?q=${encodeURIComponent(textoEndereco(e, { paraMapa: true }))}&navigate=yes`;
/** Google Maps com a rota de carro até o endereço. */
export const linkMapa = e => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(textoEndereco(e, { paraMapa: true }))}&travelmode=driving`;
const primeiroNome = s => String(s ?? '').trim().split(/\s+/)[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/**
 * Quem recebe a entrega: { nome, telefone, outraPessoa }. Em branco, é o próprio cliente.
 * outraPessoa: outro telefone (ou, sem telefone, outro nome), como num presente.
 */
export function quemRecebe(p) {
  const e = p?.entrega || {};
  const nome = String(e.recebedor_nome ?? '').trim() || String(p?.cliente_nome ?? '').trim();
  const telefone = String(e.recebedor_telefone ?? '').trim() || String(p?.cliente_telefone ?? '').trim();
  const dig = t => String(t ?? '').replace(/\D/g, '').slice(-8);
  const outraPessoa = e.recebedor_telefone && p?.cliente_telefone
    ? dig(e.recebedor_telefone) !== dig(p.cliente_telefone)
    : !!e.recebedor_nome && primeiroNome(e.recebedor_nome) !== primeiroNome(p?.cliente_nome);
  return { nome, telefone, outraPessoa };
}

const buscarComPrazo = (url, ms = 9000) => fetch(url, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});

/** Rua, bairro e cidade de um CEP: { cep, endereco, bairro, cidade }. null: o CEP não existe. */
export async function buscarCep(cep) {
  const d = String(cep ?? '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  try {
    const r = await buscarComPrazo(`https://viacep.com.br/ws/${d}/json/`, 6000);
    if (r.ok) {
      const j = await r.json();
      if (j.erro) return null;
      return { cep: d, endereco: j.logradouro || '', bairro: j.bairro || '', cidade: [j.localidade, j.uf].filter(Boolean).join(' - ') };
    }
  } catch (e) { /* tenta o outro serviço */ }
  const falhou = 'Não foi possível consultar o CEP agora. Preencha o endereço à mão.';
  let r;
  try { r = await buscarComPrazo(`https://brasilapi.com.br/api/cep/v2/${d}`); } catch (e) { throw new Error(falhou); }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(falhou);
  const j = await r.json();
  return { cep: d, endereco: j.street || '', bairro: j.neighborhood || '', cidade: [j.city, j.state].filter(Boolean).join(' - ') };
}

let ultimaBuscaMapa = 0;
/** Uma busca por vez no OpenStreetMap, com 1,1 s entre elas (regra de uso do serviço). */
async function vezDoMapa() {
  const vez = Math.max(Date.now(), ultimaBuscaMapa + 1100);
  ultimaBuscaMapa = vez;
  if (vez > Date.now()) await new Promise(r => setTimeout(r, vez - Date.now()));
}
/** Ponto do CEP pela BrasilAPI (nem todo CEP tem). */
async function pontoDoCep(cep) {
  try {
    const r = await buscarComPrazo(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    const c = r.ok ? (await r.json())?.location?.coordinates : null;
    const lat = Number(c?.latitude), lng = Number(c?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng, nivel: 'cep', nome: `CEP ${formatarCep(cep)}` } : null;
  } catch (e) { return null; }
}
const RAIO_BUSCA = 0.6;   // graus em volta da loja (uns 60 km): uma rua com o mesmo nome em outra cidade não serve
const pertoDe = (a, b) => Math.abs(a.lat - b.lat) <= RAIO_BUSCA && Math.abs(a.lng - b.lng) <= RAIO_BUSCA;
/** Precisão do que o mapa achou (place_rank do OpenStreetMap): o número da casa, só a rua ou só o bairro. */
const nivelDoMapa = rank => (rank >= 30 ? 'numero' : rank >= 26 ? 'rua' : rank >= 18 ? 'bairro' : null);
/** O endereço numa linha só ("Rua X, 44, Jardim Y, Cidade - SP", como o da loja) em { endereco, bairro, cidade }. */
function separarEndereco(linha) {
  const partes = linha.split(',').map(x => x.trim()).filter(Boolean);
  if (partes.length < 2) return { endereco: linha };
  const temNumero = partes.length > 2 && /^(n[º°o.]?\s*)?\d+\s*[a-z]?$/i.test(partes[1]);
  const resto = partes.slice(temNumero ? 2 : 1);
  return { endereco: temNumero ? `${partes[0]}, ${partes[1].replace(/^n[º°o.]?\s*/i, '')}` : partes[0], bairro: resto.slice(0, -1).join(', '), cidade: resto.at(-1) || '' };
}
const TIPO_RUA = /^(rua|r|avenida|av|travessa|tv|alameda|al|estrada|estr|rodovia|rod|praça|praca|pça|largo|viela|via)\.?$/i;
/** Sem o número da casa: "Rua das Flores, 123" e "Rua das Flores 123" viram "Rua das Flores"; "Rua 7" continua "Rua 7". */
function tirarNumero(rua) {
  const m = rua.match(/^(.+?)(?:\s*,\s*|\s+)(?:n[º°o.]?\s*)?\d+\s*[a-z]?$/i);
  const resto = m ? m[1].trim() : rua;
  return m && !TIPO_RUA.test(resto) ? resto : rua;
}
/**
 * Ponto no mapa de um endereço: { lat, lng, nivel, nome } ou null (não achou).
 * nivel: 'exato' (coordenadas coladas), 'numero', 'rua', 'cep' ou 'bairro' (os dois últimos, aproximados).
 * e: { endereco, bairro, cidade, cep } ou o endereço numa linha; também aceita coordenadas coladas do
 * Google Maps ("-22.9056, -47.0583"). perto: { lat, lng } da loja (só procura em volta dela).
 */
export async function localizarEndereco(e, { perto } = {}) {
  const linha = typeof e === 'string' ? e.trim() : '';
  const coord = linha.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (coord) return { lat: Number(coord[1]), lng: Number(coord[2]), nivel: 'exato', nome: linha };
  const end = typeof e === 'string' ? separarEndereco(linha) : (e || {});
  const limpo = x => String(x ?? '').trim();
  const rua = limpo(end.endereco), bairro = limpo(end.bairro), cidade = limpo(end.cidade), cep = limpo(end.cep).replace(/\D/g, '');
  // a cidade digitada (sem o "- SP") tem de bater com a do resultado: "Avenida Paulista, São Paulo" não pode virar a de Americana
  const norm = x => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const cidadeDigitada = norm(cidade.replace(/\s*[-/,]\s*[a-z]{2}\s*$/i, ''));
  const mesmaCidade = achado => {
    const cidades = ['city', 'town', 'village', 'municipality', 'city_district'].map(k => norm(achado.address?.[k])).filter(Boolean);
    return cidadeDigitada.length < 3 || !cidades.length || cidades.some(c => c === cidadeDigitada || c.includes(cidadeDigitada) || cidadeDigitada.includes(c));
  };
  const juntar = (...l) => l.filter(Boolean).join(', '), onde = cidade || bairro;
  // do mais completo para o mais simples: o mapa pode não conhecer o bairro (ex.: "Jardim Santo André") nem o número da casa
  const tentativas = [linha, juntar(rua, bairro, cidade), cep.length === 8 && 'cep', juntar(rua, onde), juntar(tirarNumero(rua), onde),
    bairro && cidade && juntar(bairro, cidade)];
  for (const t of [...new Set(tentativas.filter(Boolean))]) {
    if (t === 'cep') {
      const ponto = await pontoDoCep(cep);
      if (ponto && (!perto || pertoDe(ponto, perto))) return ponto;
      continue;
    }
    await vezDoMapa();
    const qs = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '1', countrycodes: 'br', 'accept-language': 'pt-BR', q: t });
    if (perto) { qs.set('viewbox', [perto.lng - RAIO_BUSCA, perto.lat + RAIO_BUSCA, perto.lng + RAIO_BUSCA, perto.lat - RAIO_BUSCA].join(',')); qs.set('bounded', '1'); }
    let r;
    try { r = await buscarComPrazo(`https://nominatim.openstreetmap.org/search?${qs}`); } catch (err) { r = null; }
    if (!r?.ok) throw new Error('O mapa não respondeu agora. Tente de novo em instantes ou digite a taxa.');
    const [achado] = await r.json();
    const nivel = achado && mesmaCidade(achado) ? nivelDoMapa(Number(achado.place_rank)) : null;
    if (nivel) return { lat: Number(achado.lat), lng: Number(achado.lon), nivel, nome: achado.display_name };
  }
  return null;
}
/** Linha reta entre dois pontos, em km. */
function kmEmLinhaReta(a, b) {
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
/**
 * Caminho de carro entre dois pontos: { km, minutos, aproximado }, pelas ruas do OpenStreetMap (OSRM).
 * Se o serviço não responder, estima pela linha reta com 30% a mais (aproximado: true).
 */
export async function distanciaDeCarro(a, b) {
  try {
    const r = await buscarComPrazo(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&alternatives=false&steps=false`);
    const j = r.ok ? await r.json() : null;
    const rota = j?.code === 'Ok' ? j.routes?.[0] : null;
    if (rota) return { km: rota.distance / 1000, minutos: Math.max(1, Math.round(rota.duration / 60)), aproximado: false };
  } catch (e) { /* sem rota: estima */ }
  const km = kmEmLinhaReta(a, b) * 1.3;
  return { km, minutos: Math.max(1, Math.round(km / 30 * 60)), aproximado: true };
}
/** Ponto de onde sai a entrega (a loja), das configurações; null enquanto não for cadastrado. */
export const origemEntrega = cfg => (cfg && cfg.entrega_origem_lat != null && cfg.entrega_origem_lng != null
  ? { lat: Number(cfg.entrega_origem_lat), lng: Number(cfg.entrega_origem_lng) } : null);
/** A regra da taxa está preenchida (Ajustes > Loja > Entrega)? */
export const temRegraEntrega = cfg => Number(cfg?.entrega_taxa_minima) > 0 || Number(cfg?.entrega_valor_km) > 0;
/**
 * Taxa pela regra da loja: a taxa mínima cobre os primeiros km e cada km a mais soma o valor por km.
 * Arredonda para cima, em reais inteiros. foraDoRaio: passou da distância máxima de entrega.
 */
export function taxaPelaDistancia(km, cfg) {
  const minima = Number(cfg?.entrega_taxa_minima) || 0, inclui = Number(cfg?.entrega_km_incluidos) || 0;
  const porKm = Number(cfg?.entrega_valor_km) || 0, raio = Number(cfg?.entrega_raio_km) || 0;
  const bruto = Math.round((minima + Math.max(0, km - inclui) * porKm) * 100) / 100;
  return { taxa: Math.max(0, Math.ceil(bruto - 0.001)), foraDoRaio: raio > 0 && km > raio };
}
/**
 * Taxa sugerida para um endereço: acha o endereço no mapa, mede o caminho de carro desde a loja e aplica a regra.
 * Devolve { km, minutos, taxa, aproximado, foraDoRaio, nivel, local }. A equipe confere e pode digitar outro valor.
 */
export async function calcularTaxaEntrega(e, cfg) {
  const origem = origemEntrega(cfg);
  if (!origem) throw new Error('Cadastre o endereço da loja em Ajustes > Loja > Entrega para calcular pela distância.');
  if (!temRegraEntrega(cfg)) throw new Error('Preencha a regra da taxa em Ajustes > Loja > Entrega para calcular pela distância.');
  if (!String(e?.endereco ?? '').trim() && !String(e?.bairro ?? '').trim()) throw new Error('Preencha o endereço para calcular.');
  const local = await localizarEndereco(e, { perto: origem });
  if (!local) throw new Error('Não achei esse endereço no mapa. Confira a rua, o bairro e a cidade, ou digite a taxa.');
  const rota = await distanciaDeCarro(origem, local);
  const km = Math.round(rota.km * 10) / 10;
  return { ...rota, km, ...taxaPelaDistancia(km, cfg), nivel: local.nivel, local };
}

/* ================================================================
   Peso final do bolo (sql/peso-final.sql)
================================================================ */
/**
 * Excesso de peso de um bolo: cada bolo pode passar até a tolerância (pediu 1 kg, tolerância de 300 g: até 1,3 kg).
 * Num item com mais de um bolo, o peso final é o de todos juntos. Igual ao gatilho do banco.
 * Devolve { limiteKg, excessoKg, valor } (excessoKg 0: dentro da tolerância), ou null sem peso final.
 */
export function excessoDePeso(item, toleranciaG) {
  const final = Number(item?.peso_final_kg), peso = Number(item?.peso_kg);
  if (!(final > 0) || !(peso > 0)) return null;
  const qtd = Math.max(1, Number(item.quantidade) || 1);
  const limiteKg = Math.round(qtd * (peso + (Number(toleranciaG) || 0) / 1000) * 1000) / 1000;
  const excessoKg = Math.max(0, Math.round((final - limiteKg) * 1000) / 1000);
  const precoKg = Number(item.preco_kg) || Number(item.preco_unitario) / peso || 0;
  return { limiteKg, excessoKg, valor: Math.round(excessoKg * precoKg * 100) / 100 };
}

/* ================================================================
   API
================================================================ */

/** Filtros da lista de pedidos (vw_pedidos), usados pela lista e pela contagem por dia. */
function filtrarPedidos(q, f) {
  if (Array.isArray(f.status) && f.status.length) q = q.in('status', f.status);
  else if (typeof f.status === 'string' && f.status) q = q.eq('status', f.status);
  if (f.apenasAbertos) q = q.eq('finalizado', false);
  if (f.sinalPago === false) q = q.eq('sinal_pago', false);
  if (f.sinalPago === true) q = q.eq('sinal_pago', true);
  if (f.comSaldo) q = q.gt('saldo', 0);
  if (f.quitado) q = q.lte('saldo', 0);
  if (f.origem) q = q.eq('origem', f.origem);
  if (f.criadoDesde) q = q.gte('criado_em', f.criadoDesde);
  if (f.antesDe) q = q.lt('data_retirada', f.antesDe);
  if (f.de) q = q.gte('data_retirada', f.de);
  if (f.ate) q = q.lte('data_retirada', f.ate);
  if (Array.isArray(f.datas)) q = q.in('data_retirada', f.datas.length ? f.datas : ['1900-01-01']);   // ex.: só os domingos
  const termo = (f.busca || '').trim().replace(/[,()*%\\]/g, ' ').trim();
  if (termo) q = q.or(['cliente_nome', 'codigo', 'cliente_telefone', 'resumo_itens'].map(c => `${c}.ilike.*${termo}*`).join(','));
  return q;
}

/**
 * Cria a API a partir de um cliente Supabase já existente.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ bucket?: string }} [opcoes]
 */
export function criarApi(supabase, opcoes = {}) {
  const bucket = opcoes.bucket || 'cardapio';

  async function rpc(nome, args) {
    return conferir(await supabase.rpc(nome, args), nome);
  }

  function urlImagem(path) {
    if (!path) return null;
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /* Entregas (sql/entregas.sql). Enquanto o script não roda, a tabela não existe e os pedidos seguem sem entrega. */
  let semEntregas = false, semStories = false;
  const urlStory = path => (path ? supabase.storage.from('stories').getPublicUrl(path).data.publicUrl : null);
  const comUrls = st => ({ ...st, url: urlStory(st.arquivo_path), miniatura: urlStory(st.miniatura_path || st.arquivo_path) });
  const extensao = tipo => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[tipo] || 'jpg';
  const faltaNoBanco = e => ['PGRST205', 'PGRST202', '42P01', '42883'].includes(e?.code) || /could not find|does not exist/i.test(e?.message || '');
  /** Entregas de vários pedidos: Map pedido_id → entrega. */
  async function entregasDe(ids) {
    const mapa = new Map(), lista = [...new Set((ids || []).filter(Boolean))];
    if (semEntregas || !lista.length) return mapa;
    const partes = Array.from({ length: Math.ceil(lista.length / 80) }, (_, i) => lista.slice(i * 80, i * 80 + 80));
    const respostas = await Promise.all(partes.map(l => supabase.from('pedido_entregas').select('*').in('pedido_id', l)));
    for (const { data, error } of respostas) {
      if (error) {
        if (faltaNoBanco(error)) { semEntregas = true; return new Map(); }
        throw new ErroApi(error, 'entregas');
      }
      for (const e of data || []) mapa.set(e.pedido_id, e);
    }
    return mapa;
  }
  /* Peso final dos bolos (sql/peso-final.sql): fica nos itens, mas o recibo_pedido não traz. Sem o script, segue sem. */
  let semPesoFinal = false;
  async function pesosFinais(pedidoId) {
    if (semPesoFinal) return null;
    const { data, error } = await supabase.from('pedido_itens').select('id, peso_final_kg').eq('pedido_id', pedidoId);
    if (error) {
      if (faltaNoBanco(error) || error.code === '42703' || /peso_final_kg/.test(error.message || '')) { semPesoFinal = true; return null; }
      throw new ErroApi(error, 'peso final');
    }
    return new Map(data.map(i => [String(i.id), i.peso_final_kg ?? null]));
  }
  /**
   * O pedido completo: a entrega (pedido.entrega: endereço, quem recebe e taxa, ou null quando é retirada) e o peso
   * final de cada bolo (item.peso_final_kg; sem o campo quando o banco ainda não tem o peso final).
   */
  async function completar(pedido) {
    if (!pedido?.id) return pedido;
    const [entregas, pesos] = await Promise.all([entregasDe([pedido.id]), pesosFinais(pedido.id)]);
    const itens = pesos ? (pedido.itens || []).map(i => ({ ...i, peso_final_kg: pesos.get(String(i.id)) ?? null })) : pedido.itens;
    return { ...pedido, entrega: entregas.get(pedido.id) || null, itens };
  }
  async function juntarEntregas(lista) {
    const mapa = await entregasDe(lista.map(p => p.id));
    return lista.map(p => ({ ...p, entrega: mapa.get(p.id) || null }));
  }

  /** CRUD genérico de uma tabela do cadastro (RLS libera escrita só para admin). */
  function tabela(nome, { chave = 'id', ordem = [['ordem', true]] } = {}) {
    return {
      async listar({ filtros = {}, ordenarPor } = {}) {
        let q = supabase.from(nome).select('*');
        for (const [col, val] of Object.entries(filtros)) {
          if (val === undefined) continue;
          if (val === null) q = q.is(col, null);
          else if (Array.isArray(val)) q = q.in(col, val);
          else q = q.eq(col, val);
        }
        for (const [col, crescente] of ordenarPor || ordem) q = q.order(col, { ascending: crescente });
        return conferir(await q, nome);
      },
      async obter(id) {
        return conferir(await supabase.from(nome).select('*').eq(chave, id).maybeSingle(), nome);
      },
      async criar(dados) {
        return conferir(await supabase.from(nome).insert(dados).select().single(), nome);
      },
      async atualizar(id, dados) {
        return conferir(await supabase.from(nome).update(dados).eq(chave, id).select().single(), nome);
      },
      async remover(id) {
        conferir(await supabase.from(nome).delete().eq(chave, id), nome);
        return true;
      },
      /** Salva a nova ordem: recebe a lista de ids na ordem desejada. */
      async reordenar(ids) {
        for (let i = 0; i < ids.length; i++) {
          conferir(await supabase.from(nome).update({ ordem: i + 1 }).eq(chave, ids[i]), nome);
        }
        return true;
      }
    };
  }

  const produtosTabela = tabela('produtos', { ordem: [['categoria_id', true], ['ordem', true], ['nome', true]] });

  return {
    supabase,
    urlImagem,

    /* -------------------------- SITE -------------------------- */
    cardapio: {
      /** Cardápio completo em uma chamada (ver docs/api.md para o formato). */
      obter: () => rpc('obter_cardapio')
    },

    /* Imagens de referência enviadas pelo cliente (bucket público "referencias", ver sql/referencias-topper.sql) */
    referencias: {
      /** Envia a imagem (File/Blob) e devolve { path, url } — a url vai na observação do item. */
      async enviar(arquivo) {
        const tipo = arquivo.type || 'image/jpeg';
        const ext = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' })[tipo] || 'jpg';
        const mes = new Date().toISOString().slice(0, 7);
        const path = `${mes}/${novaChave()}.${ext}`;
        const { error } = await supabase.storage.from('referencias').upload(path, arquivo, { cacheControl: '31536000', upsert: false, contentType: tipo });
        if (error) throw new ErroApi(error, 'imagem de referência');
        return { path, url: supabase.storage.from('referencias').getPublicUrl(path).data.publicUrl };
      }
    },

    pedidos: {
      /**
       * Grava o pedido do site. Os preços são recalculados no servidor.
       * Devolve o pedido gravado (com codigo, total, valor_sinal, itens e token).
       */
      criar: (pedido) => rpc('criar_pedido', {
        p_pedido: { chave_idempotencia: pedido.chave_idempotencia || novaChave(), ...pedido }
      }),
      /** Recibo pelo token enviado no WhatsApp (versão do cliente), com a entrega (endereço e taxa) quando houver. */
      async consultar(token) {
        const [p, entrega] = await Promise.all([rpc('consultar_pedido', { p_token: token }),
          supabase.rpc('entrega_publica', { p_token: token }).then(r => (r.error ? null : r.data), () => null)]);
        return p ? { ...p, entrega: entrega || null } : p;
      }
    },

    /* --------------------- LOGIN DA EQUIPE --------------------- */
    auth: {
      async entrar(email, senha) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw new ErroApi(error, 'login');
        return data.user;
      },
      async sair() {
        const { error } = await supabase.auth.signOut();
        if (error) throw new ErroApi(error, 'logout');
      },
      async enviarRedefinicaoSenha(email, redirecionarPara) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirecionarPara });
        if (error) throw new ErroApi(error, 'senha');
      },
      async trocarSenha(novaSenha) {
        const { error } = await supabase.auth.updateUser({ password: novaSenha });
        if (error) throw new ErroApi(error, 'senha');
      },
      async usuario() {
        const { data } = await supabase.auth.getUser();
        return data?.user ?? null;
      },
      /**
       * Cadastro do usuário logado (null se não tiver acesso). papel: 'admin', 'atendente' ou
       * 'personalizados' (quem produz topos e personalizados: só vê esse módulo, ver sql/topos.sql).
       */
      async perfil() {
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user) return null;
        const r = conferir(await supabase.from('administradores').select('*').eq('user_id', u.user.id).maybeSingle(), 'perfil');
        if (r) return r.ativo ? { ...r, email: u.user.email } : null;
        // sem o sql/topos.sql a tabela não existe: segue sem acesso
        const { data: p, error } = await supabase.from('produtores_personalizados').select('*').eq('user_id', u.user.id).maybeSingle();
        return !error && p?.ativo ? { ...p, papel: 'personalizados', email: u.user.email } : null;
      },
      /** Avatar do próprio perfil (código de backoffice/avatares.js, ou null para usar as iniciais). */
      definirAvatar: (avatar) => rpc('definir_avatar', { p_avatar: avatar || null }),
      /** Avisa quando alguém entra ou sai. Devolve uma função para parar de ouvir. */
      aoMudar(callback) {
        const { data } = supabase.auth.onAuthStateChange((evento, sessao) => callback(evento, sessao));
        return () => data.subscription.unsubscribe();
      }
    },

    /* ------------------------ BACKOFFICE ------------------------ */
    admin: {
      /** Números da tela inicial (pedidos por status, retiradas de hoje, a receber). */
      painel: (data) => rpc('resumo_painel', { p_data: data || null }),

      pedidos: {
        /**
         * Lista de pedidos com filtros e paginação.
         * @param {{status?: string|string[], de?: string, ate?: string, antesDe?: string, datas?: string[], busca?: string,
         *          apenasAbertos?: boolean, sinalPago?: boolean, comSaldo?: boolean, quitado?: boolean, origem?: string,
         *          criadoDesde?: string, pagina?: number, porPagina?: number, ordenarPor?: string, crescente?: boolean,
         *          comEntrega?: boolean}} [f]
         * busca: nome, código, telefone ou item do pedido (ex.: "kit").
         * comEntrega: junta a entrega de cada pedido (p.entrega, ou null quando é retirada).
         */
        async listar(f = {}) {
          const pagina = f.pagina || 1, porPagina = f.porPagina || 30;
          let q = filtrarPedidos(supabase.from('vw_pedidos').select('*', { count: 'exact' }), f);
          q = q.order(f.ordenarPor || 'data_retirada', { ascending: f.crescente ?? true })
               .order('hora_retirada', { ascending: true, nullsFirst: false })
               .range((pagina - 1) * porPagina, pagina * porPagina - 1);
          const { data, error, count } = await q;
          if (error) throw new ErroApi(error, 'pedidos');
          return { pedidos: f.comEntrega ? await juntarEntregas(data) : data, total: count ?? data.length, pagina, porPagina };
        },
        /** Quantos pedidos há em cada dia de retirada (mesmos filtros da lista): { 'AAAA-MM-DD': n } */
        async contarPorDia(f = {}) {
          const linhas = conferir(await filtrarPedidos(supabase.from('vw_pedidos').select('data_retirada'), f).limit(2000), 'pedidos');
          const n = {};
          for (const l of linhas) n[l.data_retirada] = (n[l.data_retirada] || 0) + 1;
          return n;
        },
        /** Pedido completo: itens, pagamentos, observações, histórico e a entrega (também usado no recibo). */
        obter: async (id) => completar(await rpc('recibo_pedido', { p_pedido_id: id })),
        /** Lançar pedido pela equipe (WhatsApp, balcão...). Mesmo formato do site. */
        criar: (pedido) => rpc('criar_pedido', { p_pedido: { origem: 'backoffice', chave_idempotencia: novaChave(), ...pedido } }),
        alterarStatus: async (id, status, comentario) =>
          completar(await rpc('alterar_status_pedido', { p_pedido_id: id, p_status: status, p_comentario: comentario ?? null })),
        /** Corrige dados do pedido (cliente, origem, retirada, desconto). Itens: admin.pedidos.itens. Status: use alterarStatus. */
        async atualizar(id, campos) {
          const permitidos = ['cliente_nome', 'cliente_telefone', 'origem', 'data_retirada', 'hora_retirada', 'observacao_cliente', 'desconto'];
          const dados = Object.fromEntries(Object.entries(campos).filter(([k]) => permitidos.includes(k)));
          conferir(await supabase.from('pedidos').update(dados).eq('id', id), 'pedido');
          return completar(await rpc('recibo_pedido', { p_pedido_id: id }));
        },
        /**
         * Peso final de um bolo (kg, na balança; null apaga). O que passar do peso pedido + tolerância vira prejuízo
         * sozinho, em Prejuízos > Excesso de peso (sql/peso-final.sql). Devolve o pedido atualizado.
         */
        async pesoFinal(pedidoId, itemId, kg) {
          conferir(await supabase.from('pedido_itens').update({ peso_final_kg: kg }).eq('id', itemId), 'peso final');
          return completar(await rpc('recibo_pedido', { p_pedido_id: pedidoId }));
        },
        adicionarObservacao: (id, texto, fixada = false) =>
          rpc('adicionar_observacao_pedido', { p_pedido_id: id, p_texto: texto, p_fixada: fixada }),
        async editarObservacao(observacaoId, { texto, fixada }) {
          const dados = {};
          if (texto !== undefined) dados.texto = texto;
          if (fixada !== undefined) dados.fixada = fixada;
          return conferir(await supabase.from('pedido_observacoes').update(dados).eq('id', observacaoId).select().single(), 'observação');
        },
        async removerObservacao(observacaoId) {
          conferir(await supabase.from('pedido_observacoes').delete().eq('id', observacaoId), 'observação');
          return true;
        },
        registrarPagamento: async (id, { valor, forma = 'pix', tipo = 'sinal', observacao = null, pagoEm = null }) =>
          completar(await rpc('registrar_pagamento', {
            p_pedido_id: id, p_valor: valor, p_forma: forma, p_tipo: tipo, p_observacao: observacao, p_pago_em: pagoEm
          })),
        async removerPagamento(pagamentoId) {
          conferir(await supabase.from('pedido_pagamentos').delete().eq('id', pagamentoId), 'pagamento');
          return true;
        },
        /** Itens do pedido (para correções feitas pela equipe). */
        itens: tabela('pedido_itens'),
        /** Exclui o pedido de vez (só admin). Para desistências, prefira o status "cancelado". */
        async remover(id) {
          conferir(await supabase.from('pedidos').delete().eq('id', id), 'pedido');
          return true;
        },
        /**
         * Avisa quando um pedido é criado ou alterado (tempo real).
         * callback({ tipo: 'INSERT' | 'UPDATE' | 'DELETE', pedido })
         * aoEstado (opcional) recebe 'SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT' ou 'CLOSED'.
         * Devolve uma função para parar de ouvir.
         */
        aoMudar(callback, aoEstado) {
          const canal = supabase
            .channel('pedidos-backoffice')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
                (m) => callback({ tipo: m.eventType, pedido: m.new && Object.keys(m.new).length ? m.new : m.old }))
            .subscribe((estado) => aoEstado?.(estado));
          return () => supabase.removeChannel(canal);
        }
      },

      /*
       * Entregas (sql/entregas.sql): endereço, quem recebe e a taxa de cada pedido com entrega.
       * A taxa entra sozinha no total do pedido (gatilho do banco). Sem o script rodado, disponivel() = false.
       */
      entregas: {
        /** O banco já tem as entregas? */
        async disponivel() {
          if (!semEntregas) {
            const { error } = await supabase.from('pedido_entregas').select('pedido_id').limit(1);
            if (error && faltaNoBanco(error)) semEntregas = true;
          }
          return !semEntregas;
        },
        /** Entregas de vários pedidos: Map pedido_id → entrega. */
        dosPedidos: (ids) => entregasDe(ids),
        /** Cria ou muda a entrega do pedido. Devolve o pedido atualizado (o total já com a taxa). */
        async salvar(pedidoId, dados) {
          const campos = ['taxa', 'cep', 'endereco', 'complemento', 'bairro', 'cidade', 'recebedor_nome', 'recebedor_telefone', 'distancia_km', 'duracao_min'];
          const linha = { pedido_id: pedidoId };
          for (const k of campos) if (dados[k] !== undefined) linha[k] = dados[k];
          conferir(await supabase.from('pedido_entregas').upsert(linha, { onConflict: 'pedido_id' }), 'entrega');
          return completar(await rpc('recibo_pedido', { p_pedido_id: pedidoId }));
        },
        /** Tira a entrega: o pedido volta a ser de retirada e a taxa sai do total. Devolve o pedido atualizado. */
        async remover(pedidoId) {
          conferir(await supabase.from('pedido_entregas').delete().eq('pedido_id', pedidoId), 'entrega');
          return completar(await rpc('recibo_pedido', { p_pedido_id: pedidoId }));
        }
      },

      /* Cadastros do cardápio */
      categorias: tabela('categorias'),
      grupos: tabela('grupos', { ordem: [['categoria_id', true], ['ordem', true]] }),
      produtos: {
        ...produtosTabela,
        /** Produtos com nome da categoria e do grupo (vista vw_produtos). */
        async listarCompleto({ categoriaId, busca, apenasAtivos } = {}) {
          let q = supabase.from('vw_produtos').select('*');
          if (categoriaId) q = q.eq('categoria_id', categoriaId);
          if (apenasAtivos) q = q.eq('ativo', true);
          const termo = (busca || '').trim().replace(/[,()*%\\]/g, ' ').trim();
          if (termo) q = q.ilike('nome', `%${termo}%`);
          q = q.order('categoria_ordem').order('grupo_ordem', { nullsFirst: true }).order('ordem').order('nome');
          return conferir(await q, 'produtos');
        },
        /** Liga/desliga o produto no site sem apagar. */
        alternarAtivo: (id, ativo) => produtosTabela.atualizar(id, { ativo })
      },
      faixasPreco: tabela('produto_faixas_preco', { ordem: [['produto_id', true], ['quantidade_minima', true]] }),
      pesosBolo: tabela('bolo_pesos', { chave: 'peso_kg', ordem: [['peso_kg', true]] }),   // do menor para o maior (a coluna ordem não vale para peso)
      massasBolo: tabela('bolo_massas'),
      formatosBolo: tabela('bolo_formatos'),
      banners: tabela('banners'),
      avisos: tabela('avisos', { ordem: [['secao', true], ['ordem', true]] }),
      status: tabela('status_pedido', { chave: 'codigo' }),
      /* Prejuízos: itens refeitos ou perdidos (ex.: bolo entregue com o sabor errado) */
      prejuizos: {
        ...tabela('prejuizos', { ordem: [['data', false], ['criado_em', false]] }),
        /** Lançamentos entre duas datas (YYYY-MM-DD), do mais recente para o mais antigo. */
        async doPeriodo(de, ate) {
          return conferir(await supabase.from('prejuizos').select('*').gte('data', de).lte('data', ate)
            .order('data', { ascending: false }).order('criado_em', { ascending: false }), 'prejuízos');
        },
        /** Vários de uma vez (um por item do pedido). */
        async criarVarios(linhas) {
          return conferir(await supabase.from('prejuizos').insert(linhas).select(), 'prejuízos');
        }
      },
      /* Excesso de peso dos bolos (sql/peso-final.sql): lançado sozinho quando o peso final passa do pedido + tolerância */
      excessosPeso: {
        /** Lançamentos entre duas datas (dia da retirada), do mais recente para o mais antigo. */
        async doPeriodo(de, ate) {
          return conferir(await supabase.from('excessos_peso').select('*').gte('data', de).lte('data', ate)
            .order('data', { ascending: false }).order('criado_em', { ascending: false }), 'excesso de peso');
        },
        /** Apaga um lançamento (só a Administração). Se a pesagem estava errada, prefira corrigir o peso final no pedido. */
        async remover(id) {
          conferir(await supabase.from('excessos_peso').delete().eq('id', id), 'excesso de peso');
          return true;
        }
      },
      /*
       * Stories (sql/stories.sql): imagens para os stories do Instagram e o status do WhatsApp, separadas em pastas.
       * Os arquivos ficam no bucket público "stories" (a imagem para postar e uma miniatura para a grade). Só a Administração.
       */
      stories: {
        /** false enquanto o sql/stories.sql não foi rodado */
        async disponivel() {
          if (!semStories) {
            const { error } = await supabase.from('stories').select('id').limit(1);
            if (error && faltaNoBanco(error)) semStories = true;
          }
          return !semStories;
        },
        /** Todas, da mais nova para a mais antiga, com url (a imagem) e miniatura. */
        async listar() {
          const linhas = conferir(await supabase.from('stories').select('*').order('criado_em', { ascending: false }), 'stories');
          return linhas.map(comUrls);
        },
        /**
         * Guarda uma imagem já preparada: { arquivo, miniatura (opcional), titulo, pasta, largura, altura }.
         * Se o registro não entrar, os arquivos enviados são apagados.
         */
        async enviar({ arquivo, miniatura = null, titulo = null, pasta = null, largura = null, altura = null }) {
          const id = novaChave(), base = `${new Date().getFullYear()}/${id}`;
          const path = `${base}.${extensao(arquivo.type)}`, mini = miniatura ? `${base}-mini.${extensao(miniatura.type)}` : null;
          const subir = async (p, blob) => {
            const { error } = await supabase.storage.from('stories').upload(p, blob, { cacheControl: '31536000', upsert: false, contentType: blob.type || 'image/jpeg' });
            if (error) throw new ErroApi(error, 'imagem');
          };
          await subir(path, arquivo);
          try {
            if (mini) await subir(mini, miniatura);
            const linha = conferir(await supabase.from('stories').insert({
              id, arquivo_path: path, miniatura_path: mini, titulo: (titulo || '').trim().slice(0, 120) || null, pasta: (pasta || '').trim().slice(0, 60) || null,
              largura: largura || null, altura: altura || null, bytes: arquivo.size ?? null
            }).select().single(), 'stories');
            return comUrls(linha);
          } catch (e) {
            await supabase.storage.from('stories').remove([path, mini].filter(Boolean)).catch(() => {});
            throw e;
          }
        },
        /** Muda o título e a pasta. */
        async atualizar(id, { titulo, pasta }) {
          const dados = {};
          if (titulo !== undefined) dados.titulo = (titulo || '').trim().slice(0, 120) || null;
          if (pasta !== undefined) dados.pasta = (pasta || '').trim().slice(0, 60) || null;
          return comUrls(conferir(await supabase.from('stories').update(dados).eq('id', id).select().single(), 'stories'));
        },
        /** Apaga o registro e os arquivos (a imagem e a miniatura). */
        async apagar(story) {
          conferir(await supabase.from('stories').delete().eq('id', story.id), 'stories');
          const { error } = await supabase.storage.from('stories').remove([story.arquivo_path, story.miniatura_path].filter(Boolean));
          if (error) console.warn('stories: os arquivos ficaram no Storage', error);
          return true;
        }
      },
      /*
       * Topos e personalizados (sql/topos.sql): pedidos próprios, feitos por quem produz os topos.
       * Status: novo, em_producao, pronto, entregue, cancelado. O histórico é gravado pelo banco.
       */
      topos: {
        /**
         * filtros: status (texto ou lista), entregaDesde / entregaAte (YYYY-MM-DD), busca, pedidoId,
         * naoPagos (ainda não pagos a quem faz) e pagamentoId (os de um pagamento), estes dois do sql/topos-gastos.sql
         */
        async listar(f = {}) {
          let q = supabase.from('topos_pedidos').select('*');
          if (Array.isArray(f.status) && f.status.length) q = q.in('status', f.status);
          else if (typeof f.status === 'string' && f.status) q = q.eq('status', f.status);
          if (f.entregaDesde) q = q.gte('data_entrega', f.entregaDesde);
          if (f.entregaAte) q = q.lte('data_entrega', f.entregaAte);
          if (f.pedidoId) q = q.eq('pedido_id', f.pedidoId);
          if (f.naoPagos) q = q.is('pagamento_id', null);
          if (f.pagamentoId) q = q.eq('pagamento_id', f.pagamentoId);
          const termo = (f.busca || '').trim().replace(/[,()*%\\]/g, ' ').trim();
          if (termo) q = q.or(['titulo', 'tema', 'texto', 'cliente_nome', 'pedido_codigo'].map(c => `${c}.ilike.*${termo}*`).join(','));
          q = q.order('data_entrega', { ascending: f.crescente ?? true }).order('hora_entrega', { ascending: true, nullsFirst: false }).order('numero');
          if (f.limite) q = q.limit(f.limite);
          return conferir(await q, 'topos');
        },
        obter: async (id) => conferir(await supabase.from('topos_pedidos').select('*').eq('id', id).single(), 'topo'),
        criar: async (dados) => conferir(await supabase.from('topos_pedidos').insert(dados).select().single(), 'topo'),
        async atualizar(id, campos) {
          const { id: _i, numero, criado_em, criado_por, atualizado_em, ...dados } = campos;
          return conferir(await supabase.from('topos_pedidos').update(dados).eq('id', id).select().single(), 'topo');
        },
        alterarStatus: async (id, status) => conferir(await supabase.from('topos_pedidos').update({ status }).eq('id', id).select().single(), 'topo'),
        async remover(id) {
          conferir(await supabase.from('topos_pedidos').delete().eq('id', id), 'topo');
          return true;
        },
        historico: async (id) => conferir(await supabase.from('topos_historico').select('*').eq('topo_id', id).order('criado_em'), 'histórico do topo'),
        /*
         * Gastos com topos (sql/topos-gastos.sql): quanto pagar a quem faz. Cada pedido tem custo_unitario (vem da
         * tabela de preços pelo "O que fazer"; custo_manual quando a Administração digitou) e, depois de pago, pagamento_id.
         */
        precos: {
          listar: async () => conferir(await supabase.from('topos_precos').select('*').order('ordem').order('nome'), 'tabela de preços'),
          /** Troca a tabela inteira: [{ nome, valor }] (valor por unidade). Os topos ainda não pagos passam a seguir a tabela nova. */
          salvar: (lista) => rpc('salvar_precos_topos', { p_precos: lista })
        },
        pagamentos: {
          /**
           * Pagamentos a quem faz, do mais recente para o mais antigo (a Administração e quem produz veem).
           * de / ate (YYYY-MM-DD): pela data do pagamento. naoConfirmados: os que quem faz ainda não confirmou que recebeu.
           */
          async listar({ de, ate, limite, naoConfirmados } = {}) {
            let q = supabase.from('topos_pagamentos').select('*');
            if (de) q = q.gte('pago_em', de);
            if (ate) q = q.lte('pago_em', ate);
            if (naoConfirmados) q = q.is('confirmado_em', null);
            q = q.order('pago_em', { ascending: false }).order('criado_em', { ascending: false });
            if (limite) q = q.limit(limite);
            return conferir(await q, 'pagamentos dos topos');
          },
          obter: async (id) => conferir(await supabase.from('topos_pagamentos').select('*').eq('id', id).single(), 'pagamento'),
          /** Paga os topos escolhidos (prontos ou entregues, com valor). valor: o que foi pago de fato (sem ele, a soma dos topos). */
          registrar: ({ topos, valor = null, forma = 'pix', pagoEm = null, observacao = null }) =>
            rpc('registrar_pagamento_topos', { p_topos: topos, p_valor: valor, p_forma: forma, p_pago_em: pagoEm, p_observacao: observacao }),
          /** Desfaz: apaga o pagamento e os topos dele voltam para "a pagar". */
          async remover(id) {
            conferir(await supabase.from('topos_pagamentos').delete().eq('id', id), 'pagamento');
            return true;
          },
          /** Quem faz os topos confirma que recebeu (só ela). */
          confirmar: (id) => rpc('confirmar_pagamento_topos', { p_pagamento_id: id })
        },
        /** Avisa quando um pedido de topo é criado, alterado ou apagado. Devolve uma função para parar de ouvir. */
        aoMudar(callback, aoEstado) {
          const canal = supabase
            .channel('topos-backoffice')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'topos_pedidos' },
                (m) => callback({ tipo: m.eventType, topo: m.new && Object.keys(m.new).length ? m.new : m.old }))
            .subscribe((estado) => aoEstado?.(estado));
          return () => supabase.removeChannel(canal);
        }
      },
      /*
       * Estoque (sql/estoque.sql, só a Administração). A quantidade só muda por movimentar (entrada,
       * saída, ajuste) ou pela baixa automática dos pedidos; o banco registra o histórico e avisa
       * (notificacoes) quando o item chega no mínimo.
       */
      estoque: {
        listar: async () => conferir(await supabase.from('estoque_itens').select('*').order('nome'), 'estoque'),
        criar: async (dados) => conferir(await supabase.from('estoque_itens').insert(dados).select().single(), 'item de estoque'),
        async atualizar(id, campos) {
          const { id: _i, quantidade, criado_em, atualizado_em, ...dados } = campos;   // quantidade: use movimentar
          return conferir(await supabase.from('estoque_itens').update(dados).eq('id', id).select().single(), 'item de estoque');
        },
        async remover(id) {
          conferir(await supabase.from('estoque_itens').delete().eq('id', id), 'item de estoque');
          return true;
        },
        /** tipo: 'entrada' | 'saida' | 'ajuste' (contagem: a quantidade passa a ser exatamente a informada) */
        movimentar: (itemId, tipo, quantidade, motivo) =>
          rpc('movimentar_estoque', { p_item_id: itemId, p_tipo: tipo, p_quantidade: quantidade, p_motivo: motivo || null }),
        movimentos: async (itemId, limite = 60) => conferir(await supabase.from('estoque_movimentos').select('*').eq('item_id', itemId)
          .order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(limite), 'histórico do estoque'),
        /** Baixa automática: quanto de cada item os produtos do cardápio gastam. */
        consumos: async () => conferir(await supabase.from('estoque_consumos').select('*'), 'baixa automática'),
        /** Troca a lista de produtos ligados ao item: [{ produto_id, quantidade, por_kg }] */
        async salvarConsumos(itemId, lista) {
          conferir(await supabase.from('estoque_consumos').delete().eq('item_id', itemId), 'baixa automática');
          if (lista.length) conferir(await supabase.from('estoque_consumos').insert(lista.map(c => ({ item_id: itemId, produto_id: c.produto_id, quantidade: c.quantidade, por_kg: !!c.por_kg }))), 'baixa automática');
          return true;
        }
      },
      /* Avisos da equipe (sino do backoffice), criados pelo banco: ex.: topo pronto (sql/topos.sql), estoque acabando (sql/estoque.sql) */
      notificacoes: {
        async listar({ naoLidas = false, limite = 30 } = {}) {
          let q = supabase.from('notificacoes').select('*');
          if (naoLidas) q = q.is('lida_em', null);
          return conferir(await q.order('criado_em', { ascending: false }).limit(limite), 'avisos');
        },
        /** Marca como visto (para toda a equipe). Sem id: todos os que ainda não foram vistos. */
        async marcarVista(id) {
          let q = supabase.from('notificacoes').update({ lida_em: new Date().toISOString() });
          q = id ? q.eq('id', id) : q.is('lida_em', null);
          conferir(await q, 'avisos');
          return true;
        },
        aoMudar(callback) {
          const canal = supabase
            .channel('avisos-backoffice')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes' },
                (m) => callback({ tipo: m.eventType, aviso: m.new && Object.keys(m.new).length ? m.new : m.old }))
            .subscribe();
          return () => supabase.removeChannel(canal);
        }
      },
      /*
       * Notificações no celular e no computador, mesmo com o app fechado (sql/notificacoes-celular.sql + função "notificar").
       * Cada aparelho tem um endereço de entrega (endpoint) e escolhe o que quer receber (tipos).
       */
      push: {
        /** Chave pública das notificações (null: ninguém ligou ainda). */
        chave: () => rpc('chave_push'),
        /** Na primeira vez: guarda o par de chaves criado pelo app. Devolve a chave pública que ficou valendo. */
        iniciar: (publica, privada) => rpc('iniciar_push', { p_publica: publica, p_privada: privada }),
        salvarAparelho: ({ endpoint, p256dh, auth, tipos, aparelho }) =>
          rpc('salvar_aparelho_push', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_tipos: tipos, p_aparelho: aparelho || null }),
        removerAparelho: (endpoint) => rpc('remover_aparelho_push', { p_endpoint: endpoint }),
        /** O cadastro deste aparelho (só os da própria pessoa aparecem), ou null. */
        meuAparelho: async (endpoint) => conferir(await supabase.from('push_aparelhos').select('*').eq('endpoint', endpoint).maybeSingle(), 'notificações'),
        /** Manda uma notificação de teste para este aparelho. */
        testar: (endpoint) => rpc('testar_push', { p_endpoint: endpoint })
      },
      /* Quem produz os personalizados: entra no backoffice e só vê o módulo de topos */
      personalizados: {
        listar: async () => conferir(await supabase.from('produtores_personalizados').select('*').order('nome'), 'equipe de personalizados'),
        salvar: ({ email, nome, ativo = true }) => rpc('salvar_produtor_personalizados', { p_email: email, p_nome: nome, p_ativo: ativo }),
        remover: (userId) => rpc('remover_produtor_personalizados', { p_user_id: userId })
      },

      /* Equipe: o usuário é criado no Supabase (Authentication > Users) e liberado aqui pelo e-mail */
      equipe: {
        listar: () => rpc('listar_equipe'),
        salvar: ({ email, nome, papel = 'atendente', ativo = true }) =>
          rpc('salvar_membro_equipe', { p_email: email, p_nome: nome, p_papel: papel, p_ativo: ativo }),
        remover: (userId) => rpc('remover_membro_equipe', { p_user_id: userId })
      },

      configuracoes: {
        obter: async () => conferir(await supabase.from('configuracoes').select('*').eq('id', 1).single(), 'configurações'),
        salvar: async (campos) => {
          const { id, atualizado_em, ...dados } = campos;
          return conferir(await supabase.from('configuracoes').update(dados).eq('id', 1).select().single(), 'configurações');
        }
      },

      /* Fotos do cardápio (bucket público "cardapio") */
      imagens: {
        /**
         * Envia um arquivo (File/Blob) e devolve { path, url }.
         * Guarde o path no cadastro (ex.: produtos.imagem_path).
         */
        async enviar(arquivo, pasta = 'produtos') {
          const nome = String(arquivo.name || 'imagem').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.]+/g, '-');
          const path = `${pasta}/${Date.now()}-${nome}`;
          const { error } = await supabase.storage.from(bucket)
            .upload(path, arquivo, { cacheControl: '31536000', upsert: false, contentType: arquivo.type || undefined });
          if (error) throw new ErroApi(error, 'imagem');
          return { path, url: urlImagem(path) };
        },
        async remover(path) {
          const { error } = await supabase.storage.from(bucket).remove([path]);
          if (error) throw new ErroApi(error, 'imagem');
          return true;
        },
        async listar(pasta = '') {
          const { data, error } = await supabase.storage.from(bucket).list(pasta, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
          if (error) throw new ErroApi(error, 'imagem');
          return data.map(f => ({ ...f, path: pasta ? `${pasta}/${f.name}` : f.name, url: urlImagem(pasta ? `${pasta}/${f.name}` : f.name) }));
        }
      }
    },

    util: { formatarPreco, formatarPeso, formatarData, novaChave, linkWhatsApp, abrirWhatsApp, alvoWhatsApp, linkCompartilhavel, linkRecibo, montarMensagemWhatsApp, montarMensagemStatus, prepararAba, separarReferencia, juntarReferencia, ehTopper, PIX, pixDe, textoPix,
      formatarCep, textoEndereco, linkWaze, linkMapa, quemRecebe, buscarCep, localizarEndereco, distanciaDeCarro, taxaPelaDistancia, calcularTaxaEntrega, origemEntrega, temRegraEntrega, excessoDePeso }
  };
}

/**
 * Atalho para o navegador: carrega o supabase-js do CDN e devolve a API pronta.
 * Use sempre a chave pública (publishable / anon). Nunca a secret / service_role.
 * opcoes.anonimo = true no site público (ignora a sessão da equipe).
 */
export async function conectar(url, chaveAnon, opcoes = {}) {
  if (!url || !chaveAnon || /COLE_AQUI/.test(url + chaveAnon)) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY em js/config.js.');
  }
  const { createClient } = await import(SUPABASE_JS);
  // anonimo: true -> o site público nunca usa o login da equipe, mesmo no mesmo navegador
  const auth = opcoes.anonimo
    ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ritabolos-site' }
    : { persistSession: true, autoRefreshToken: true, storageKey: 'ritabolos-auth' };
  const supabase = createClient(url, chaveAnon, { auth });
  return criarApi(supabase, opcoes);
}
