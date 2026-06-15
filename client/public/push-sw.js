self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "알림", body: event.data.text() };
  }

  const title = payload.title || "알림";
  const body = payload.body || "";
  const url = payload.url || "/";
  const tag = payload.tag || undefined;
  const options = {
    body,
    tag,
    data: { url, jobId: payload.jobId || null, kind: payload.kind || "general" },
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({
            type: "WEB_PUSH_NOTIFICATION_CLICK",
            payload: event.notification.data || {},
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
