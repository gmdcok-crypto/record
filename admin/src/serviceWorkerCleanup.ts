function isStandaloneAdminHost(): boolean {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".netlify.app") || host.endsWith(".github.io")) return true;
  return !window.location.pathname.startsWith("/admin/");
}

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
      continue;
    }

    const isWrongStandaloneAdminWorker =
      isStandaloneAdminHost() && /\/admin\/admin-push-sw\.js($|\?)/.test(script);
    if (isWrongStandaloneAdminWorker) {
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
