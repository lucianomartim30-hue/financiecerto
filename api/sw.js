// Service Worker — FinancieCerto
// Estratégia: network-first para index.html (garante atualizações imediatas)
// cache-first para assets estáticos; stale-while-revalidate para fontes externas
const CACHE = 'financiecerto-v3';

// Assets essenciais do app shell (single-file HTML — tudo inline)
const SHELL = ['/index.html', '/manifest.json', '/'];

// Assets externos opcionais (falha não impede instalação)
const OPTIONAL = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap'
];

// Cache cada asset individualmente — falha em um não afeta os outros
async function precache() {
  const cache = await caches.open(CACHE);
  const results = await Promise.allSettled(
    SHELL.map(url =>
      fetch(url, { cache: 'no-cache' })
        .then(r => { if (r.ok) return cache.put(url, r); })
        .catch(() => {}) // ignora falha de asset individual
    )
  );
  // Fontes externas: tenta cachear sem bloquear install
  await Promise.allSettled(
    OPTIONAL.map(url =>
      fetch(url).then(r => { if (r.ok) return cache.put(url, r); }).catch(() => {})
    )
  );
  return results;
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // App shell: network-first (garante que atualizações aparecem imediatamente)
  // Fallback para cache apenas se sem conexão
  if (url.pathname === '/' || url.pathname.endsWith('index.html') || url.pathname.endsWith('manifest.json')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() =>
        caches.match(e.request).then(cached => cached || new Response('Sem conexão', { status: 503 }))
      )
    );
    return;
  }

  // Outros recursos: network-first, cache como fallback
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp && resp.ok && resp.type === 'basic') {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request).then(c => c || new Response('', { status: 503 })))
  );
});
