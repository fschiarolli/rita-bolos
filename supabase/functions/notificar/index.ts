/**
 * Função "notificar" (Supabase Edge Function): entrega uma notificação (Web Push) em um aparelho.
 *
 * Quem chama é o banco (sql/notificacoes-celular.sql), uma chamada por aparelho, com o endereço de entrega do
 * aparelho, as chaves das notificações e a mensagem. A função cifra a mensagem (RFC 8291), assina o pedido de
 * entrega (VAPID, RFC 8292) e entrega no serviço do aparelho (Google, Apple, Microsoft ou Mozilla).
 * Responde 410 quando o serviço diz que o aparelho não existe mais: o banco apaga esse aparelho.
 * Não guarda nada e não usa segredos próprios: tudo vem na chamada. Só entrega para os serviços de notificação.
 *
 * Publicar (uma vez):
 *   Supabase > Edge Functions > Deploy a new function > Via Editor > nome "notificar" > cole este arquivo > Deploy.
 *   Depois, nos detalhes da função, desligue "Enforce JWT verification" (quem chama é o banco, sem login).
 *   Pela linha de comando: supabase functions deploy notificar --no-verify-jwt
 */

// serviços de notificação aceitos (Chrome/Android, Apple, Edge/Windows, Firefox): nenhum outro endereço recebe nada
const SERVICOS = ['fcm.googleapis.com', 'push.apple.com', 'notify.windows.com', 'push.services.mozilla.com'];
const texto = new TextEncoder();

/** base64url sem "=" ↔ bytes */
export const paraB64u = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const deB64u = (s: string): Uint8Array => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), c => c.charCodeAt(0));
};
const juntar = (...partes: ArrayLike<number>[]): Uint8Array => {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};
async function hmac(chave: Uint8Array, dados: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dados));
}

/**
 * Cifra a mensagem para o aparelho (RFC 8291, aes128gcm). p256dh e auth vêm da inscrição do aparelho.
 * sal e parLocal só são passados nos testes.
 */
export async function cifrar(mensagem: string, p256dh: string, auth: string,
                             { sal = crypto.getRandomValues(new Uint8Array(16)), parLocal = null as CryptoKeyPair | null } = {}): Promise<Uint8Array> {
  const uaPublica = deB64u(p256dh), segredo = deB64u(auth);
  const local = parLocal || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublica = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const chaveUa = await crypto.subtle.importKey('raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartilhado = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveUa }, local.privateKey, 256));
  // chave e nonce (HKDF com SHA-256, RFC 8291 seção 3.4)
  const prkChave = await hmac(segredo, compartilhado);
  const ikm = await hmac(prkChave, juntar(texto.encode('WebPush: info\0'), uaPublica, asPublica, [1]));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, juntar(texto.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, juntar(texto.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const chave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, chave, juntar(texto.encode(mensagem), [2])));
  // cabeçalho (RFC 8188): sal, tamanho do registro (4096), tamanho da chave (65) e a chave pública desta entrega
  return juntar(sal, [0, 0, 16, 0], [65], asPublica, cifrado);
}

/** Cabeçalho Authorization (VAPID, RFC 8292): prova para o serviço de notificação que a entrega é deste sistema. */
export async function cabecalhoVapid(endpoint: string, publica: string, privada: string, assunto: string): Promise<string> {
  const pub = deB64u(publica);
  const jwk = { kty: 'EC', crv: 'P-256', d: privada, x: paraB64u(pub.slice(1, 33)), y: paraB64u(pub.slice(33, 65)) };
  const chave = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const u = new URL(endpoint);
  const json = (o: unknown) => paraB64u(texto.encode(JSON.stringify(o)));
  const dados = `${json({ typ: 'JWT', alg: 'ES256' })}.${json({ aud: `${u.protocol}//${u.host}`, exp: Math.floor(Date.now() / 1000) + 3600, sub: assunto })}`;
  const assinatura = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, texto.encode(dados)));
  return `vapid t=${dados}.${paraB64u(assinatura)}, k=${publica}`;
}

type Pedido = {
  endpoint: string; p256dh: string; auth: string;
  vapid: { publica: string; privada: string; assunto?: string };
  mensagem: Record<string, unknown>;
};

/** O que há de errado na chamada (ou '' se estiver tudo certo). */
export function conferir(d: Pedido): string {
  let host = '';
  try { const u = new URL(d?.endpoint); host = u.protocol === 'https:' ? u.hostname : ''; } catch { host = ''; }
  if (!SERVICOS.some(s => host === s || host.endsWith('.' + s))) return 'Endereço de entrega desconhecido.';
  if (!d.p256dh || !d.auth || !d.vapid?.publica || !d.vapid?.privada) return 'Faltam as chaves.';
  if (!d.mensagem || typeof d.mensagem !== 'object') return 'Falta a mensagem.';
  return '';
}

/** Entrega no serviço de notificação do aparelho. TTL: guarda por até 1 dia se o aparelho estiver desligado. */
export async function entregar(d: Pedido): Promise<Response> {
  const corpo = await cifrar(JSON.stringify(d.mensagem), d.p256dh, d.auth);
  return fetch(d.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Urgency': 'high',
      'Authorization': await cabecalhoVapid(d.endpoint, d.vapid.publica, d.vapid.privada, d.vapid.assunto || 'mailto:avisos@ritabolos.com.br')
    },
    body: corpo
  });
}

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

export async function atender(req: Request): Promise<Response> {
  if (req.method !== 'POST') return resposta({ ok: true, funcao: 'notificar' });
  let d: Pedido;
  try { d = await req.json(); } catch { return resposta({ erro: 'Corpo inválido.' }, 400); }
  const erro = conferir(d);
  if (erro) return resposta({ erro }, 400);
  try {
    const r = await entregar(d);
    const detalhe = (await r.text().catch(() => '')).slice(0, 300);
    // 404/410: o aparelho não existe mais (app desinstalado, permissão tirada) e o banco apaga
    const status = r.status === 404 || r.status === 410 ? 410 : r.ok ? 200 : 502;
    return resposta({ entrega: r.status, detalhe }, status);
  } catch (e) {
    return resposta({ erro: String((e as Error)?.message || e) }, 500);
  }
}

// no Supabase (Deno) a função atende as chamadas; nos testes, só as partes acima são usadas
declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void } | undefined;
if (typeof Deno !== 'undefined') Deno.serve(atender);
