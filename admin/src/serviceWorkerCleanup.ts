export async function clearStaleClientPwaServiceWorkers(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  let removed = false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    const script =
      registration.active?.scriptURL ||
      registration.waiting?.scriptURL ||
      registration.installing?.scriptURL ||
      "";
    const isClientPwaWorker = /\/sw\.js($|\?)/.test(script) || script.includes("workbox");
    if (isClientPwaWorker) {
      removed = (await registration.unregister()) || removed;
    }
  }

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("workbox") || key.includes("precache"))
        .map((key) => caches.delete(key)),
    );
  }

  return removed;
}
