declare global {
  interface Window {
    ChannelIO?: (...args: unknown[]) => void;
    ChannelIOInitialized?: boolean;
  }
}

const CHANNEL_PLUGIN_KEY = import.meta.env.VITE_CHANNEL_TALK_PLUGIN_KEY?.trim() ?? "";
const CHANNEL_SCRIPT_SRC = "https://cdn.channel.io/plugin/ch-plugin-web.js";
const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
const PUBLIC_CONFIG_ENDPOINTS = [
  `${window.location.origin}/api/public-config`,
  API_URL ? `${API_URL}/api/public-config` : "",
].filter(Boolean);

type ChannelBootProfile = {
  memberId?: string | number | null;
  name?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
};

let lastProfile: ChannelBootProfile | undefined;
let resolvedPluginKey = "";
let publicConfigPromise: Promise<string> | null = null;

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

  const injectScript = () => {
    const script = document.createElement("script");
    script.async = true;
    script.src = CHANNEL_SCRIPT_SRC;
    script.charset = "utf-8";
    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
      return;
    }
    document.head.appendChild(script);
  };

  if (document.readyState === "complete") {
    injectScript();
  } else {
    window.addEventListener("DOMContentLoaded", injectScript, { once: true });
    window.addEventListener("load", injectScript, { once: true });
  }
}

function fetchPublicConfigPluginKey(): Promise<string> {
  if (publicConfigPromise) return publicConfigPromise;
  publicConfigPromise = PUBLIC_CONFIG_ENDPOINTS.reduce<Promise<string>>((promise, endpoint) => {
    return promise.catch(() =>
      fetch(endpoint)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`public-config fetch failed: ${endpoint}`);
          }
          return response.json() as Promise<{ channelTalkPluginKey?: string }>;
        })
        .then((config) => {
          const key = config?.channelTalkPluginKey?.trim() ?? "";
          if (!key) {
            throw new Error(`empty channelTalkPluginKey from ${endpoint}`);
          }
          resolvedPluginKey = key;
          return key;
        }),
    );
  }, Promise.reject(new Error("public-config not attempted"))).catch((error) => {
    console.warn(error);
    return resolvedPluginKey;
  });
  return publicConfigPromise;
}

async function getChannelPluginKey(): Promise<string> {
  if (resolvedPluginKey) return resolvedPluginKey;
  const publicKey = await fetchPublicConfigPluginKey();
  if (publicKey) return publicKey;
  resolvedPluginKey = CHANNEL_PLUGIN_KEY;
  return resolvedPluginKey;
}

export function channelTalkEnabled(): boolean {
  return true;
}

export async function bootChannelTalk(profile?: ChannelBootProfile) {
  lastProfile = profile;
  const pluginKey = await getChannelPluginKey();
  if (!pluginKey) return;

  ensureChannelStub();
  ensureChannelScript();
  const memberId =
    profile?.memberId != null && String(profile.memberId).trim()
      ? `member-${String(profile.memberId).trim()}`
      : undefined;

  window.ChannelIO?.("boot", {
    pluginKey,
    memberId,
    profile: {
      name: profile?.name?.trim() || undefined,
      email: profile?.email?.trim() || undefined,
      mobileNumber: profile?.mobileNumber?.trim() || undefined,
    },
  });
}

export function showChannelTalkMessenger() {
  void bootChannelTalk(lastProfile)
    .then(() => {
      window.setTimeout(() => {
        window.ChannelIO?.("showMessenger");
      }, 200);
    })
    .catch((error) => {
      console.error(error);
    });
}

export function shutdownChannelTalk() {
  window.ChannelIO?.("shutdown");
}

