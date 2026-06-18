import { getApiUrl, type MemberProfile, registerPushSubscription, unregisterPushSubscription } from "./api";

type PublicConfigResponse = {
  webPushEnabled?: boolean;
  webPushVapidPublicKey?: string;
};

const SERVICE_WORKER_READY_TIMEOUT_MS = 15_000;
const PUSH_SUBSCRIBE_TIMEOUT_MS = 20_000;
const PUSH_REGISTER_TIMEOUT_MS = 20_000;

function base64UrlToUint8Array(base64String: string): Uint8Array {
  const cleaned = base64String.trim().replace(/^=+/, "").replace(/=+$/, "");
  const padding = "=".repeat((4 - (cleaned.length % 4)) % 4);
  const normalized = (cleaned + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
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

async function ensureActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("이 브라우저에서는 웹푸시를 지원하지 않습니다.");
  }

  return withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_READY_TIMEOUT_MS,
    "알림 설정 준비 시간이 초과되었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  );
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  try {
    return await withTimeout(navigator.serviceWorker.ready, 5_000, "");
  } catch {
    return existing ?? null;
  }
}

export async function getNotificationPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function hasRegisteredPushSubscription(): Promise<boolean> {
  const registration = await getPushRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  return Boolean(subscription);
}

export async function syncWebPushRegistration(member: MemberProfile): Promise<boolean> {
  const registration = await getPushRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await withTimeout(
    registerPushSubscription(subscriptionPayload(subscription)),
    PUSH_REGISTER_TIMEOUT_MS,
    "서버에 알림 등록 요청이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
  );
  await postActiveMemberToServiceWorker(member);
  return true;
}

export async function enableWebPush(member: MemberProfile): Promise<"enabled" | "unsupported" | "denied" | "disabled"> {
  const permissionState = await getNotificationPermissionState();
  if (permissionState === "unsupported") return "unsupported";

  // Request permission before any network/SW wait so mobile browsers keep the tap gesture.
  const permission = permissionState === "default" ? await Notification.requestPermission() : permissionState;
  if (permission !== "granted") return "denied";

  const config = await fetchWebPushConfig();
  if (!config.enabled || !config.vapidPublicKey) return "disabled";

  let registration: ServiceWorkerRegistration;
  try {
    registration = await ensureActiveServiceWorkerRegistration();
  } catch (error) {
    throw error instanceof Error ? error : new Error("알림 설정에 필요한 준비가 끝나지 않았습니다.");
  }

  const existing = await registration.pushManager.getSubscription();
  const createdNewSubscription = !existing;
  const subscription =
    existing ??
    (await withTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
      }),
      PUSH_SUBSCRIBE_TIMEOUT_MS,
      "브라우저 푸시 구독이 지연되고 있습니다. 알림 권한을 확인한 뒤 다시 시도해 주세요.",
    ));

  try {
    await withTimeout(
      registerPushSubscription(subscriptionPayload(subscription)),
      PUSH_REGISTER_TIMEOUT_MS,
      "서버에 알림 등록 요청이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
    );
  } catch (error) {
    if (createdNewSubscription) {
      await subscription.unsubscribe().catch(() => undefined);
    }
    throw error;
  }

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
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.active?.postMessage({
    type: "SET_ACTIVE_MEMBER",
    payload: {
      memberId: member.id,
      memberName: member.name,
    },
  });
}
