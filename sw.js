/* 鳥籠 · PWA 通知用的 Service Worker
   只负责显示“回复好了”的通知，以及点通知时把 App 叫回前台。
   不缓存页面，避免旧版本卡住。 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const target = new URL('./', scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(scope)) {
        try { await client.focus(); } catch (e) { /* 忽略 */ }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
