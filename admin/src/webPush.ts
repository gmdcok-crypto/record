import {
  fetchWebPushConfig,
  registerAdminPushSubscription,
  unregisterAdminPushSubscription,
} from "./api";

const SERVICE_WORKER_READY_TIMEOUT_MS = 15_000;
const PUSH_SUBSCRIBE_TIMEOUT_MS = 20_000;
const PUSH_REGISTER_TIMEOUT_MS = 20_000;

function isStandaloneAdminHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".netlify.app") || host.endsWith(".github.io")) return true;
  return !window.location.pathname.startsWith("/admin/");
}

function adminPushServiceWorkerPaths(): { scriptUrl: string; scope: string } {
  if (isStandaloneAdminHost()) {
    return { scriptUrl: "/admin-push-sw.js", scope: "/" };
  }
  return { scriptUrl: "/admin/admin-push-sw.js", scope: "/admin/" };
}

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

async function findPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  const { scope } = adminPushServiceWorkerPaths();
  const scoped = await navigator.serviceWorker.getRegistration(scope);
  if (scoped) return scoped;

  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function ensureActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("이 브라우저에서는 웹푸시를 지원하지 않습니다.");
  }

  const { scriptUrl, scope } = adminPushServiceWorkerPaths();
  let registration = await findPushRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register(scriptUrl, { scope });
  }

  if (registration.active) {
    return registration;
  }

  await withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_READY_TIMEOUT_MS,
    "알림 설정 준비 시간이 초과되었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  );

  registration = (await findPushRegistration()) ?? registration;
  if (!registration.active) {
    throw new Error("알림 설정에 필요한 준비가 끝나지 않았습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
  }

  return registration;
}

export async function registerAdminPushServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const { scriptUrl, scope } = adminPushServiceWorkerPaths();
  await navigator.serviceWorker.register(scriptUrl, { scope });
}

export async function getAdminNotificationPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function hasRegisteredAdminPushSubscription(): Promise<boolean> {
  const registration = await findPushRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  return Boolean(subscription);
}

export async function enableAdminWebPush(): Promise<"enabled" | "unsupported" | "denied" | "disabled"> {
  const permissionState = await getAdminNotificationPermissionState();
  if (permissionState === "unsupported") return "unsupported";

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
      registerAdminPushSubscription(subscriptionPayload(subscription)),
      PUSH_REGISTER_TIMEOUT_MS,
      "서버에 알림 등록 요청이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
    );
  } catch (error) {
    if (createdNewSubscription) {
      await subscription.unsubscribe().catch(() => undefined);
    }
    throw error;
  }

  return "enabled";
}

export async function disableAdminWebPush(): Promise<void> {
  const registration = await findPushRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await unregisterAdminPushSubscription(subscriptionPayload(subscription)).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
