export async function clearStaleClientPwaServiceWorkers(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  let removed = false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    removed = (await registration.unregister()) || removed;
  }

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  return removed;
}
