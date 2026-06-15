import {
  fetchWebPushConfig,
  registerAdminPushSubscription,
  unregisterAdminPushSubscription,
} from "./api";

function base64UrlToUint8Array(base64String: string): Uint8Array {
  const cleaned = base64String.trim().replace(/^=+/, "").replace(/=+$/, "");
  const padding = "=".repeat((4 - (cleaned.length % 4)) % 4);
  const normalized = (cleaned + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function subscriptionPayload(subscription: PushSubscription) {
  const keys = subscription.toJSON().keys ?? {};
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: keys.p256dh ?? "",
      auth: keys.auth ?? "",
    },
    user_agent: navigator.userAgent,
  };
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/admin/");
  if (existing) return existing;
  return navigator.serviceWorker.ready.catch(() => null);
}

export async function registerAdminPushServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/admin/admin-push-sw.js", { scope: "/admin/" });
}

export async function getAdminNotificationPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function hasRegisteredAdminPushSubscription(): Promise<boolean> {
  const registration = await getPushRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  return Boolean(subscription);
}

export async function enableAdminWebPush(): Promise<"enabled" | "unsupported" | "denied" | "disabled"> {
  const permissionState = await getAdminNotificationPermissionState();
  if (permissionState === "unsupported") return "unsupported";

  const config = await fetchWebPushConfig();
  if (!config.enabled || !config.vapidPublicKey) return "disabled";

  const registration = await getPushRegistration();
  if (!registration) return "unsupported";

  const permission = permissionState === "default" ? await Notification.requestPermission() : permissionState;
  if (permission !== "granted") return "denied";

  const existing = await registration.pushManager.getSubscription();
  const createdNewSubscription = !existing;
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
    }));

  try {
    await registerAdminPushSubscription(subscriptionPayload(subscription));
  } catch (error) {
    if (createdNewSubscription) {
      await subscription.unsubscribe().catch(() => undefined);
    }
    throw error;
  }

  return "enabled";
}

export async function disableAdminWebPush(): Promise<void> {
  const registration = await getPushRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await unregisterAdminPushSubscription(subscriptionPayload(subscription)).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
