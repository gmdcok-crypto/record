function shouldKeepServiceWorker(scriptUrl: string): boolean {
  if (!scriptUrl) return false;
  if (scriptUrl.includes("push-sw.js")) return true;
  if (scriptUrl.includes("/sw.js")) return true;
  if (scriptUrl.includes("workbox-")) return true;
  return false;
}

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
    if (shouldKeepServiceWorker(scriptUrl)) {
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
