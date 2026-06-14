import { getApiUrl, type MemberProfile, registerPushSubscription, unregisterPushSubscription } from "./api";

type PublicConfigResponse = {
  webPushEnabled?: boolean;
  webPushVapidPublicKey?: string;
};

const PUSH_SW_PATH = "/push-sw.js";

function base64UrlToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function fetchWebPushConfig(): Promise<{ enabled: boolean; vapidPublicKey: string }> {
  const response = await fetch(`${getApiUrl()}/api/public-config`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as PublicConfigResponse;
  return {
    enabled: Boolean(data.webPushEnabled && data.webPushVapidPublicKey),
    vapidPublicKey: data.webPushVapidPublicKey?.trim() ?? "",
  };
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register(PUSH_SW_PATH);
}

export async function getNotificationPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function enableWebPush(member: MemberProfile): Promise<"enabled" | "unsupported" | "denied" | "disabled"> {
  const permissionState = await getNotificationPermissionState();
  if (permissionState === "unsupported") return "unsupported";

  const config = await fetchWebPushConfig();
  if (!config.enabled || !config.vapidPublicKey) return "disabled";

  const registration = await getPushRegistration();
  if (!registration) return "unsupported";

  const permission = permissionState === "default" ? await Notification.requestPermission() : permissionState;
  if (permission !== "granted") return "denied";

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
    }));

  await registerPushSubscription({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.toJSON().keys?.p256dh ?? "",
      auth: subscription.toJSON().keys?.auth ?? "",
    },
    user_agent: navigator.userAgent,
  });

  await postActiveMemberToServiceWorker(member);
  return "enabled";
}

export async function disableWebPush(): Promise<void> {
  const registration = await getPushRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await unregisterPushSubscription({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.toJSON().keys?.p256dh ?? "",
      auth: subscription.toJSON().keys?.auth ?? "",
    },
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

export async function postActiveMemberToServiceWorker(member: MemberProfile): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_PATH);
  registration?.active?.postMessage({
    type: "SET_ACTIVE_MEMBER",
    payload: {
      memberId: member.id,
      memberName: member.name,
    },
  });
}
