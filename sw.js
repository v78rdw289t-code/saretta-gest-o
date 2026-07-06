// ============================================================
// SERVICE WORKER — Saretta Gestão v1.7
// Estratégia: cache-first para o app shell (HTML/CSS/JS),
// pass-through para o Apps Script (API calls sempre vão à rede).
// Atualizar CACHE_NAME a cada deploy para invalidar arquivos antigos.
// ============================================================

const CACHE_NAME = 'saretta-shell-v3.5.0';

// Todos os arquivos que formam o "app shell" — carregados uma vez
// e servidos do cache daí em diante, mesmo sem internet.
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'assets/img/logo-icon.svg',
  'assets/img/logo.svg',
  'assets/img/logo-app.png?v=3.5.0',
  'assets/css/style.css?v=3.5.0',
  'assets/js/api.js?v=3.5.0',
  'assets/js/utils.js?v=3.5.0',
  'assets/js/notif.js?v=3.5.0',
  'assets/js/outbox.js?v=3.5.0',
  'assets/js/home.js?v=3.5.0',
  'assets/js/agenda.js?v=3.5.0',
  'assets/js/os.js?v=3.5.0',
  'assets/js/financeiro.js?v=3.5.0',
  'assets/js/clientes.js?v=3.5.0',
  'assets/js/estoque.js?v=3.5.0',
  'assets/js/compras.js?v=3.5.0',
  'assets/js/fiado.js?v=3.5.0',
  'assets/js/insights.js?v=3.5.0',
  'assets/js/config.js?v=3.5.0',
  'assets/js/lib/html2pdf.bundle.min.js',
  'assets/js/pdf.js?v=3.5.0',
  'assets/js/app.js?v=3.5.0',
];

// ─── INSTALL: cacheia o shell completo ───────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting()) // ativa imediatamente sem esperar fechar abas
  );
});

// ─── ACTIVATE: limpa caches de versões anteriores ────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME) // mantém só o cache atual
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // assume controle de todas as abas abertas
  );
});

// ─── FETCH: intercepta requisições ───────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Requisições para o Google Apps Script (API) — sempre vai à rede.
  // O cache de dados é responsabilidade do localStorage em api.js.
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('googleusercontent.com')
  ) {
    return; // deixa o browser tratar normalmente
  }

  // App shell: cache first → se não tem, busca na rede e armazena
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request)
        .then(response => {
          // Só cacheia respostas válidas (não erros, não opaque cross-origin)
          if (response && response.ok && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline e não está em cache: para navegação entrega o index.html
          // (o app cuida de mostrar os dados do localStorage)
          if (e.request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
    })
  );
});
