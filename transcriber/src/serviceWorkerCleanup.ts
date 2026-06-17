export async function clearStaleClientPwaServiceWorkers(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  let removed = false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    const scriptUrl =
      registration.active?.scriptURL ||
      registration.installing?.scriptURL ||
      registration.waiting?.scriptURL ||
      "";
    if (scriptUrl.includes("push-sw.js")) {
      continue;
    }
    removed = (await registration.unregister()) || removed;
  }

  if (removed && "caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  return removed;
}
