export type PushPermissionState = NotificationPermission | "unsupported";

export const PUSH_PROMPT_DISMISS_KEY = "client_push_prompt_dismissed";

export function isPushPromptDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(PUSH_PROMPT_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissPushPromptForSession(): void {
  try {
    sessionStorage.setItem(PUSH_PROMPT_DISMISS_KEY, "1");
  } catch {
    // no-op
  }
}

export function clearPushPromptDismissal(): void {
  try {
    sessionStorage.removeItem(PUSH_PROMPT_DISMISS_KEY);
  } catch {
    // no-op
  }
}

export function pushNeedsSetup(
  permission: PushPermissionState,
  pushRegistered: boolean,
): boolean {
  if (permission === "unsupported") return false;
  return !pushRegistered || permission !== "granted";
}
