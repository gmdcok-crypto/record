declare global {
  interface Window {
    ChannelIO?: (...args: unknown[]) => void;
    ChannelIOInitialized?: boolean;
  }
}

const CHANNEL_PLUGIN_KEY = import.meta.env.VITE_CHANNEL_TALK_PLUGIN_KEY?.trim() ?? "";
const CHANNEL_SCRIPT_SRC = "https://cdn.channel.io/plugin/ch-plugin-web.js";

type ChannelBootProfile = {
  memberId?: string | number | null;
  name?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
};

function ensureChannelStub() {
  if (window.ChannelIO) return;

  window.ChannelIO = function (...args: unknown[]) {
    const queue = ((window.ChannelIO as unknown as { q?: unknown[][] }).q ??= []);
    queue.push(args);
  };
}

function ensureChannelScript() {
  if (window.ChannelIOInitialized) return;
  window.ChannelIOInitialized = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = CHANNEL_SCRIPT_SRC;
  script.charset = "utf-8";
  document.head.appendChild(script);
}

export function channelTalkEnabled(): boolean {
  return Boolean(CHANNEL_PLUGIN_KEY);
}

export function bootChannelTalk(profile?: ChannelBootProfile) {
  if (!CHANNEL_PLUGIN_KEY) return;

  ensureChannelStub();
  ensureChannelScript();

  const memberId =
    profile?.memberId != null && String(profile.memberId).trim()
      ? String(profile.memberId).trim()
      : undefined;

  window.ChannelIO?.("boot", {
    pluginKey: CHANNEL_PLUGIN_KEY,
    memberId,
    profile: {
      name: profile?.name?.trim() || undefined,
      email: profile?.email?.trim() || undefined,
      mobileNumber: profile?.mobileNumber?.trim() || undefined,
    },
  });
}

export function showChannelTalkMessenger() {
  if (!CHANNEL_PLUGIN_KEY) return;
  window.ChannelIO?.("showMessenger");
}

export function shutdownChannelTalk() {
  if (!CHANNEL_PLUGIN_KEY) return;
  window.ChannelIO?.("shutdown");
}

