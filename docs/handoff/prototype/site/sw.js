// Офлайн-кэш оболочки приложения; тайлы карты и погода кэшируются по мере просмотра.
const C='kgp-v3';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png'])));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
 if(u.hostname.includes('nominatim'))return;
 e.respondWith(caches.match(e.request).then(hit=>{const net=fetch(e.request).then(r=>{if(r.ok&&(u.origin===location.origin||u.hostname.includes('tile.openstreetmap')||u.hostname.includes('cdnjs')||u.hostname.includes('fonts.g')))caches.open(C).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>hit);return u.hostname.includes('open-meteo')?net.then(r=>r||hit):(hit||net);}));});
