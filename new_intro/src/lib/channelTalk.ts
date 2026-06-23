import { fetchPublicConfig } from "./publicConfig";

type ChannelIOFn = ((command: "boot", options: { pluginKey: string }) => void) &
  ((command: "showMessenger") => void) & {
    q?: unknown[];
    c?: (args: IArguments) => void;
  };

declare global {
  interface Window {
    ChannelIO?: ChannelIOFn;
    ChannelIOInitialized?: boolean;
  }
}

const CHANNEL_SCRIPT_SRC = "https://cdn.channel.io/plugin/ch-plugin-web.js";

let channelPluginKey = "";
let configPromise: Promise<string> | null = null;
let scriptLoadPromise: Promise<void> | null = null;

function ensureChannelStub(): ChannelIOFn {
  if (window.ChannelIO) return window.ChannelIO;

  const channel = function channel(...args: unknown[]) {
    channel.c?.(args as unknown as IArguments);
  } as ChannelIOFn;
  channel.q = [];
  channel.c = (args) => {
    channel.q?.push(args);
  };
  window.ChannelIO = channel;
  return channel;
}

function loadChannelScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve) => {
    ensureChannelStub();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHANNEL_SCRIPT_SRC}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        existing.dataset.loaded = "1";
        resolve();
      }, { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
      window.setTimeout(resolve, 3000);
      return;
    }

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = CHANNEL_SCRIPT_SRC;
    script.addEventListener("load", () => {
      script.dataset.loaded = "1";
      window.ChannelIOInitialized = true;
      resolve();
    }, { once: true });
    script.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(script);
    window.setTimeout(resolve, 3000);
  });

  return scriptLoadPromise;
}

export function bootChannelTalk(pluginKey: string): void {
  if (!pluginKey) return;
  channelPluginKey = pluginKey;
  ensureChannelStub();
  void loadChannelScript().then(() => {
    window.ChannelIO?.("boot", { pluginKey });
  });
}

export async function preloadChannelTalk(): Promise<string> {
  if (!configPromise) {
    configPromise = fetchPublicConfig().then((config) => {
      const pluginKey = config.channelTalkPluginKey;
      bootChannelTalk(pluginKey);
      return pluginKey;
    });
  }
  return configPromise;
}

export async function showChannelTalkMessenger(): Promise<void> {
  const pluginKey = channelPluginKey || (await preloadChannelTalk());
  if (!pluginKey) {
    window.alert("상담 채팅 설정이 아직 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  bootChannelTalk(pluginKey);
  await loadChannelScript();
  window.setTimeout(() => {
    window.ChannelIO?.("showMessenger");
  }, 200);
}
