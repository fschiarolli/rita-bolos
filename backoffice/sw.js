/*
 * Service worker do backoffice e do quadro da TV: é o que deixa instalar o sistema como app (celular e computador).
 * - Sempre busca na rede primeiro: os dados vêm do Supabase e cada publicação traz arquivos novos, que valem na hora.
 * - Guarda uma cópia dos arquivos das telas: sem internet, o app abre mesmo assim e avisa que está sem conexão.
 * - Só mexe nos arquivos deste site. Chamadas ao Supabase, fontes e bibliotecas de fora passam direto, sem cópia.
 * - Mostra as notificações que chegam com o app fechado (sql/notificacoes-celular.sql) e, no toque, abre a tela certa.
 * Mudou a lista ou a forma de guardar? Troque a VERSAO: a cópia antiga é apagada sozinha.
 */
const VERSAO = 'rb-backoffice-v3';
const ESSENCIAIS = ['./', './index.html', './app.js', './avatares.js', './logo.png', './quadro.html', './quadro.js',
  './manifest.webmanifest', './quadro.webmanifest', './icones/app-192.png', './icones/quadro-192.png',
  '../js/rita-api.js', '../js/calendario.js', '../js/config.js', '../icons/icon-192.png'];

self.addEventListener('install', e => {
  // um arquivo que falhar não impede a instalação: ele entra na cópia na próxima vez que for usado
  e.waitUntil(caches.open(VERSAO).then(c => Promise.all(ESSENCIAIS.map(u => c.add(u).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(nomes => Promise.all(nomes.filter(n => n.startsWith('rb-backoffice-') && n !== VERSAO).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const copia = res.clone();
        caches.open(VERSAO).then(c => c.put(req, copia)).catch(() => {});
      }
      return res;
    } catch (erro) {
      // sem internet: a cópia guardada (ignorando ?demo e afins); para abrir uma tela, a página do app
      const guardada = await caches.match(req, { ignoreSearch: true });
      if (guardada) return guardada;
      if (req.mode === 'navigate') {
        const pagina = await caches.match(url.pathname.endsWith('quadro.html') ? './quadro.html' : './index.html');
        if (pagina) return pagina;
      }
      throw erro;
    }
  })());
});

/* Notificação que chega pelo serviço do aparelho, mesmo com o app fechado */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (erro) { d = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Rita Bolos', {
    body: d.texto || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,          // a mesma notificação de novo (ex.: o mesmo pedido) toca outra vez, sem empilhar
    lang: 'pt-BR',
    icon: 'icones/app-192.png',
    badge: 'icones/aviso-badge.png',
    data: { url: d.url || './' }
  }));
});

/* Tocou na notificação: abre (ou traz para frente) o app já na tela do aviso */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = janelas.find(j => j.url.startsWith(self.registration.scope) && !j.url.includes('quadro.html'));
    if (!app) return self.clients.openWindow(url);
    app.postMessage({ tipo: 'abrir', url });   // o app troca de tela sem recarregar
    return app.focus();
  })());
});
