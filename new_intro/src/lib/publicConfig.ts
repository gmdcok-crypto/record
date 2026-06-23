const RAILWAY_API_BASE = "https://record-production.up.railway.app";

export type PublicConfig = {
  channelTalkPluginKey: string;
  portoneStoreId: string;
  portonePaymentChannelKey: string;
  portoneIdentityChannelKey: string;
  portoneEnv: string;
  portonePaymentEnabled: boolean;
  portoneIdentityEnabled: boolean;
};

export function getApiBase(): string {
  const origin = window.location.origin;
  const host = window.location.hostname;

  if (host.endsWith(".netlify.app") || host.endsWith(".github.io")) {
    return RAILWAY_API_BASE;
  }
  if (origin === "null" || origin.startsWith("file:")) {
    return RAILWAY_API_BASE;
  }
  if (host === "record-production.up.railway.app") {
    return origin;
  }
  return origin || RAILWAY_API_BASE;
}

function getPublicConfigEndpoints(): string[] {
  const origin = window.location.origin.replace(/\/$/, "");
  const endpoints: string[] = [];

  if (origin && origin !== "null" && !origin.startsWith("file:")) {
    endpoints.push(`${origin}/api/public-config`);
  }

  const apiBase = getApiBase().replace(/\/$/, "");
  const apiEndpoint = `${apiBase}/api/public-config`;
  if (!endpoints.includes(apiEndpoint)) {
    endpoints.push(apiEndpoint);
  }

  const railwayEndpoint = `${RAILWAY_API_BASE}/api/public-config`;
  if (!endpoints.includes(railwayEndpoint)) {
    endpoints.push(railwayEndpoint);
  }

  return endpoints;
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const endpoints = getPublicConfigEndpoints();
  let lastError: unknown;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`public-config fetch failed: ${endpoint}`);
      const data = (await res.json()) as Partial<PublicConfig>;
      return {
        channelTalkPluginKey: data.channelTalkPluginKey?.trim() ?? "",
        portoneStoreId: data.portoneStoreId?.trim() ?? "",
        portonePaymentChannelKey: data.portonePaymentChannelKey?.trim() ?? "",
        portoneIdentityChannelKey: data.portoneIdentityChannelKey?.trim() ?? "",
        portoneEnv: data.portoneEnv?.trim() ?? "live",
        portonePaymentEnabled: Boolean(data.portonePaymentEnabled),
        portoneIdentityEnabled: Boolean(data.portoneIdentityEnabled),
      };
    } catch (error) {
      lastError = error;
    }
  }

  console.warn(lastError);
  return {
    channelTalkPluginKey: "",
    portoneStoreId: "",
    portonePaymentChannelKey: "",
    portoneIdentityChannelKey: "",
    portoneEnv: "live",
    portonePaymentEnabled: false,
    portoneIdentityEnabled: false,
  };
}
