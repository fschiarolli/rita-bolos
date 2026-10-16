/** WhatsApp Cloud API. Configuração e publicação: docs/whatsapp.md. */
import { montarMensagemStatus, itensWhatsApp, linkRecibo } from '../../../js/rita-api.js';
type Json = Record<string, any>;
type Opcoes = { env: (nome: string) => string | undefined; fetch?: typeof fetch; agora?: () => number };
const encoder = new TextEncoder();
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class Falha extends Error {
  status: number;
  constructor(mensagem: string, status = 400) { super(mensagem); this.status = status; }
}
export function telefoneWhatsApp(valor: unknown): string {
  let n = String(valor || '').replace(/\D/g, '');
  if (n.length === 10 || n.length === 11) n = '55' + n;
  if (!/^[1-9]\d{10,14}$/.test(n)) throw new Falha('O telefone do pedido precisa incluir DDD e número.');
  return n;
}
/** Preserva todos os caracteres, sem quebrar pares Unicode nem cortar informações dos kits. */
export function dividirTexto(texto: string): string[] {
  if (!texto.trim() || texto.length > 20000) throw new Falha('A mensagem deve ter entre 1 e 20.000 caracteres.');
  const partes: string[] = [];
  while (texto.length > 4000) {
    let corte = texto.lastIndexOf('\n', 4000);
    if (corte < 2000) corte = 4000;
    else corte++;
    if (/[\uD800-\uDBFF]/.test(texto[corte - 1])) corte--;
    partes.push(texto.slice(0, corte)); texto = texto.slice(corte);
  }
  if (texto) partes.push(texto);
  return partes;
}
export async function assinaturaValida(corpo: string, assinatura: string, segredo: string): Promise<boolean> {
  if (!segredo || !/^sha256=[a-f0-9]{64}$/.test(assinatura)) return false;
  const chave = await crypto.subtle.importKey('raw', encoder.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(assinatura.slice(7).match(/../g)!, x => parseInt(x, 16));
  return crypto.subtle.verify('HMAC', chave, bytes, encoder.encode(corpo));
}
const hash = async (texto: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(texto))), b => b.toString(16).padStart(2, '0')).join('');
const resposta = (dados: unknown, status = 200) => new Response(JSON.stringify(dados), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export function criarHandler({ env, fetch: buscar = fetch, agora = Date.now }: Opcoes) {
  const url = () => env('SUPABASE_URL') || '';
  const chave = () => env('SUPABASE_SERVICE_ROLE_KEY') || '';
  const configurada = () => ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_GRAPH_VERSION', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_TEMPLATE', 'WHATSAPP_AUTOMATION_SECRET'].filter(k => !env(k));
  async function banco(caminho: string, method = 'GET', dados?: unknown, jwt?: string): Promise<any> {
    const r = await buscar(`${url()}/rest/v1/${caminho}`, { method,
      headers: { apikey: chave(), Authorization: `Bearer ${jwt || chave()}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: dados === undefined ? undefined : JSON.stringify(dados), signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Falha('Não foi possível acessar a integração no banco. Confira a instalação de sql/whatsapp.sql.', 503);
    return r.status === 204 ? null : r.json();
  }
  async function meta(caminho: string, dados?: unknown): Promise<Json> {
    const versao = env('WHATSAPP_GRAPH_VERSION') || '';
    const numeroId = env('WHATSAPP_PHONE_NUMBER_ID') || '';
    if (!/^v\d+\.\d+$/.test(versao) || !/^\d+$/.test(numeroId)) throw new Falha('Confira a versão da API e o identificador do número da Meta.', 503);
    let r: Response;
    try {
      r = await buscar(`https://graph.facebook.com/${versao}/${numeroId}${caminho}`, {
        method: dados ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
        body: dados ? JSON.stringify(dados) : undefined, signal: AbortSignal.timeout(15000)
      });
    } catch { throw new Falha('A Meta não confirmou o resultado. Confira o histórico antes de reenviar.', 504); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) {
      const c = Number(d.error?.code);
      const mensagem = c === 190 ? 'O token da Meta expirou ou não é válido.'
        : c === 131047 ? 'A conversa saiu da janela de 24 horas. O cliente precisa responder ao modelo de atualização.'
        : [132000, 132001, 132012, 132015, 132016].includes(c) ? 'Confira a aprovação, o idioma e os três parâmetros do modelo na Meta.'
        : c === 131030 ? 'No modo de teste da Meta, cadastre este telefone como destinatário permitido.'
        : `A Meta recusou a mensagem${c ? ` (código ${c})` : ''}. Confira o cadastro do número e o modelo.`;
      throw new Falha(mensagem, r.status >= 500 ? 504 : 422);
    }
    return d;
  }
  const atualizar = (id: string, dados: Json) => banco(`whatsapp_envios?id=eq.${id}`, 'PATCH', dados);
  async function janelaAberta(telefone: string) {
    const [c] = await banco(`whatsapp_contatos?telefone=eq.${telefone}&select=ultima_mensagem_em`);
    const desde = c ? Date.parse(c.ultima_mensagem_em) : NaN;
    return Number.isFinite(desde) && desde <= agora() && agora() - desde < 86400000;
  }
  async function enviarParte(envio: Json, parte: number, mensagem: Json) {
    // Reserva antes de chamar a Meta. Timeout ou queda não provoca reenvio automático.
    await banco('whatsapp_partes', 'POST', { envio_id: envio.id, parte, tipo: mensagem.type });
    const d = await meta('/messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to: envio.telefone, ...mensagem });
    if (!d.messages?.[0]?.id) throw new Falha('A Meta não retornou a identificação da mensagem. Confira o histórico antes de reenviar.', 504);
    await banco(`whatsapp_partes?envio_id=eq.${envio.id}&parte=eq.${parte}`, 'PATCH', { meta_id: d.messages[0].id, estado: 'aceito' });
  }
  async function enviarTexto(envio: Json) {
    try {
      const partes = dividirTexto(envio.texto);
      for (let i = 0; i < partes.length; i++) await enviarParte(envio, i + 1, { type: 'text', text: { preview_url: false, body: partes[i] } });
      await atualizar(envio.id, { estado: 'aceito', erro: null });
      return { id: envio.id, estado: 'aceito', partes: partes.length };
    } catch (e) {
      await atualizar(envio.id, { estado: e instanceof Falha && e.status === 422 ? 'falhou' : 'incerto', erro: (e as Error).message });
      throw e;
    }
  }
  async function equipe(req: Request) {
    const jwt = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!jwt) throw new Falha('Entre com uma conta da equipe.', 401);
    const r = await buscar(`${url()}/auth/v1/user`, { headers: { apikey: chave(), Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Falha('Sua sessão expirou. Entre novamente.', 401);
    const u = await r.json();
    if (!UUID.test(u.id || '')) throw new Falha('Sessão inválida.', 401);
    const [p] = await banco(`administradores?user_id=eq.${u.id}&ativo=eq.true&select=user_id,papel`, 'GET', undefined, jwt);
    if (!p) throw new Falha('Apenas a equipe da loja pode usar esta integração.', 403);
    return { jwt, id: u.id };
  }
  async function webhook(req: Request) {
    const u = new URL(req.url);
    if (req.method === 'GET') {
      if (!env('WHATSAPP_VERIFY_TOKEN') || u.searchParams.get('hub.mode') !== 'subscribe' || u.searchParams.get('hub.verify_token') !== env('WHATSAPP_VERIFY_TOKEN')) return resposta({ erro: 'Verificação inválida.' }, 403);
      return new Response(u.searchParams.get('hub.challenge') || '', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405);
    const corpo = await req.text();
    if (corpo.length > 1000000) return resposta({ erro: 'Evento muito grande.' }, 413);
    if (!await assinaturaValida(corpo, req.headers.get('x-hub-signature-256') || '', env('WHATSAPP_APP_SECRET') || '')) return resposta({ erro: 'Assinatura inválida.' }, 401);
    const d = JSON.parse(corpo);
    if (d.object !== 'whatsapp_business_account') return resposta({ ok: true });
    for (const entry of d.entry || []) for (const change of entry.changes || []) {
      const v = change.value || {};
      if (v.metadata?.phone_number_id !== env('WHATSAPP_PHONE_NUMBER_ID')) continue;
      for (const s of v.statuses || []) {
        if (!s.id || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        await banco('rpc/whatsapp_status', 'POST', { p_meta_id: s.id, p_estado: s.status, p_erro: s.errors?.[0]?.code ? `Meta: ${s.errors[0].code}` : null });
      }
      for (const m of v.messages || []) {
        if (!m.from || !m.timestamp || m.type === 'system') continue;
        const telefone = telefoneWhatsApp(m.from), momento = Number(m.timestamp) * 1000;
        if (!Number.isFinite(momento) || momento > agora() + 60000) continue;
        await banco('rpc/whatsapp_recebido', 'POST', { p_telefone: telefone, p_quando: new Date(Math.min(momento, agora())).toISOString() });
        const [cfg] = await banco('configuracoes?id=eq.1&select=whatsapp_api_ativa');
        if (!cfg?.whatsapp_api_ativa || !await janelaAberta(telefone)) continue;
        const pendentes = await banco(`whatsapp_envios?telefone=eq.${telefone}&estado=eq.aguardando_resposta&order=criado_em.asc`);
        for (const envio of pendentes) {
          const [pedido] = await banco(`pedidos?id=eq.${envio.pedido_id}&select=whatsapp_autorizado,cliente_telefone`);
          if (!pedido?.whatsapp_autorizado || telefoneWhatsApp(pedido.cliente_telefone) !== telefone) continue;
          const [reserva] = await banco(`whatsapp_envios?id=eq.${envio.id}&estado=eq.aguardando_resposta`, 'PATCH', { estado: 'processando' });
          if (reserva) await enviarTexto(envio);
        }
      }
    }
    return resposta({ ok: true });
  }
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      if (new URL(req.url).pathname.endsWith('/webhook')) return await webhook(req);
      if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405);
      const automatico = new URL(req.url).pathname.endsWith('/automatico');
      if (automatico && (!env('WHATSAPP_AUTOMATION_SECRET') || await hash(req.headers.get('authorization') || '') !== await hash(`Bearer ${env('WHATSAPP_AUTOMATION_SECRET')}`))) throw new Falha('Automação não autorizada.', 401);
      const usuario = automatico ? { id: null, jwt: undefined } : await equipe(req);
      const corpo = await req.text();
      if (corpo.length > 30000) throw new Falha('Mensagem muito grande.', 413);
      let d = JSON.parse(corpo), evento: Json | undefined, pedidoAutomatico: Json | undefined;
      const concluir = async (dados: Json) => {
        if (evento) await banco(`whatsapp_automacoes?id=eq.${evento.id}`, 'PATCH', { processado_em: new Date(agora()).toISOString() });
        return resposta(dados);
      };
      if (automatico) {
        if (!UUID.test(d.evento_id || '')) throw new Falha('Evento inválido.');
        [evento] = await banco(`whatsapp_automacoes?id=eq.${d.evento_id}`);
        if (!evento) throw new Falha('Evento não encontrado.', 404);
        if (evento.processado_em) return resposta({ estado: 'processado', repetido: true });
        const [registro] = await banco(`pedidos?id=eq.${evento.pedido_id}&select=token,whatsapp_autorizado,cliente_telefone`);
        if (!registro?.whatsapp_autorizado) return concluir({ estado: 'cancelado' });
        const [cfg] = await banco('configuracoes?id=eq.1');
        if (!cfg?.whatsapp_api_ativa) throw new Falha('Integração desativada.', 409);
        pedidoAutomatico = await banco('rpc/consultar_pedido', 'POST', { p_token: registro.token });
        if (!pedidoAutomatico?.id) throw new Falha('Pedido não encontrado.', 404);
        pedidoAutomatico.cliente_telefone = registro.cliente_telefone;
        pedidoAutomatico.token = registro.token;
        const [entrega] = await banco(`pedido_entregas?pedido_id=eq.${evento.pedido_id}`);
        const [status] = await banco(`status_pedido?codigo=eq.${encodeURIComponent(evento.status)}`);
        // As automações deste fluxo vão ao cliente que fez o pedido, inclusive quando é um presente.
        const p = { ...pedidoAutomatico, entrega: entrega ? { ...entrega, recebedor_nome: pedidoAutomatico.cliente_nome, recebedor_telefone: pedidoAutomatico.cliente_telefone } : null };
        let texto = montarMensagemStatus(p, status || { codigo: evento.status, nome: evento.status }, linkRecibo(p.token, cfg.url_site), cfg);
        if (!['recebido','confirmado'].includes(evento.status)) texto += '\n\n*Itens do pedido:*\n' + itensWhatsApp(p.itens);
        d = { acao: 'enviar', chave: evento.id, pedido_id: evento.pedido_id, destinatario: 'cliente', autorizado: true, texto };
      }
      const faltam = configurada();
      if (d.acao === 'conexao') {
        if (faltam.length) return resposta({ pronta: false, faltam });
        const n = await meta('?fields=display_phone_number,verified_name');
        const [cfg] = await banco('configuracoes?id=eq.1&select=whatsapp_numero');
        const [integracao] = await banco('whatsapp_integracao?id=eq.1&select=segredo');
        if (integracao?.segredo !== env('WHATSAPP_AUTOMATION_SECRET')) throw new Falha('A chave da automação no Supabase não corresponde à configuração da função.', 503);
        if (telefoneWhatsApp(n.display_phone_number) !== telefoneWhatsApp(cfg?.whatsapp_numero)) throw new Falha('O número da Meta é diferente do WhatsApp cadastrado em Ajustes > Loja. Confira os dois cadastros.');
        return resposta({ pronta: true, numero: n.display_phone_number, nome: n.verified_name });
      }
      if (d.acao !== 'enviar') throw new Falha('Ação inválida.');
      if (faltam.length) throw new Falha('A integração com a Meta ainda não foi configurada.', 503);
      if (!UUID.test(d.pedido_id || '') || !UUID.test(d.chave || '')) throw new Falha('Pedido ou identificação de envio inválidos.');
      if (d.autorizado !== true) throw new Falha('Confirme que o destinatário autorizou mensagens sobre este pedido.');
      if (typeof d.texto !== 'string') throw new Falha('Informe a mensagem.');
      dividirTexto(d.texto);
      if (!['cliente', 'recebedor'].includes(d.destinatario)) throw new Falha('Destinatário inválido.');
      const [cfg] = await banco('configuracoes?id=eq.1&select=whatsapp_api_ativa,url_site');
      if (!cfg?.whatsapp_api_ativa) throw new Falha('Ative a integração em Ajustes > Loja.');
      const p = pedidoAutomatico || await banco('rpc/recibo_pedido', 'POST', { p_pedido_id: d.pedido_id }, usuario.jwt);
      if (!p?.id) throw new Falha('Pedido não encontrado.', 404);
      if (!automatico) {
        const [registro] = await banco(`pedidos?id=eq.${p.id}&select=whatsapp_autorizado`);
        if (!registro?.whatsapp_autorizado) throw new Falha('Registre a autorização do cliente antes de enviar pelo sistema.');
      }
      const [entrega] = d.destinatario === 'recebedor' ? await banco(`pedido_entregas?pedido_id=eq.${p.id}&select=recebedor_nome,recebedor_telefone`, 'GET', undefined, usuario.jwt) : [];
      const telefone = telefoneWhatsApp(entrega?.recebedor_telefone || p.cliente_telefone);
      const resumo_hash = await hash(JSON.stringify([p.id, telefone, d.texto]));
      const [anterior] = await banco(`whatsapp_envios?id=eq.${d.chave}&select=id,estado,resumo_hash,erro`);
      if (anterior) {
        if (!automatico && anterior.resumo_hash !== resumo_hash) throw new Falha('Este envio já foi usado para outra mensagem.', 409);
        return concluir({ id: anterior.id, estado: anterior.estado, erro: anterior.erro, repetido: true });
      }
      const aberta = await janelaAberta(telefone);
      // O modelo de abertura usa apenas nome, código e link. O texto completo segue após a resposta do cliente.
      let recibo = '';
      if (!aberta) {
        try {
          const base = new URL(cfg.url_site);
          if (base.protocol !== 'https:') throw new Error();
          recibo = new URL(`recibo.html?t=${encodeURIComponent(p.token)}`, base.href.replace(/[^/]*$/, '')).href;
        } catch { throw new Falha('Cadastre o endereço HTTPS do site em Ajustes > Loja para enviar o modelo de atualização.'); }
        if (d.destinatario === 'recebedor' && telefone !== telefoneWhatsApp(p.cliente_telefone)) {
          throw new Falha('Para avisar outro recebedor pela API, ele precisa iniciar uma conversa com a loja. O recibo é enviado apenas ao cliente.');
        }
      }
      const envio = { id: d.chave, pedido_id: p.id, autor_id: usuario.id, telefone, texto: d.texto, resumo_hash };
      await banco('whatsapp_envios', 'POST', envio);
      if (aberta) return concluir(await enviarTexto(envio));
      try {
        await enviarParte(envio, 0, { type: 'template', template: { name: env('WHATSAPP_TEMPLATE'), language: { code: env('WHATSAPP_TEMPLATE_LANGUAGE') || 'pt_BR' },
          components: [{ type: 'body', parameters: [String(p.cliente_nome || 'Cliente').replace(/\s+/g, ' ').slice(0, 100), String(p.codigo), recibo].map(text => ({ type: 'text', text })) }] } });
        await atualizar(envio.id, { estado: 'aguardando_resposta' });
        return concluir({ id: envio.id, estado: 'aguardando_resposta' });
      } catch (e) {
        await atualizar(envio.id, { estado: e instanceof Falha && e.status === 422 ? 'falhou' : 'incerto', erro: (e as Error).message });
        throw e;
      }
    } catch (e) {
      return resposta({ erro: e instanceof Falha ? e.message : 'Não foi possível concluir. Confira o histórico antes de reenviar.' }, e instanceof Falha ? e.status : 500);
    }
  };
}
declare const Deno: { env: { get: (nome: string) => string | undefined }; serve: (handler: (req: Request) => Promise<Response>) => void };
if (typeof Deno !== 'undefined') Deno.serve(criarHandler({ env: nome => Deno.env.get(nome) }));
