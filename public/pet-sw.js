// Service worker for My Monshi reminders. It only handles push notifications.
self.addEventListener('push', (e) => {
  let d = { title: 'Monshi', body: 'Come say hi!', url: '/pet' };
  try { d = { ...d, ...e.data.json() }; } catch { /* plain push */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: '/icon-192.png', badge: '/favicon-32.png', data: { url: d.url } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/pet';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => { for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } } return self.clients.openWindow(url); }));
});
