import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.cloudflare.com/client/v4";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloudflare API error ${res.status}: ${text}`);
  }
  return res.json();
}

function getToken(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.apiToken as string;
}

export default function cloudflare(rl: RunlinePluginAPI) {
  rl.setName("cloudflare");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Cloudflare API token",
      env: "CLOUDFLARE_API_TOKEN",
    },
  });

  rl.registerAction("zoneCertificate.get", {
    access: "read",
    description: "Get a zone-level origin certificate",
    inputSchema: {
      zoneId: { type: "string", required: true, description: "Zone ID" },
      certificateId: {
        type: "string",
        required: true,
        description: "Certificate ID",
      },
    },
    async execute(input, ctx) {
      const { zoneId, certificateId } = input as {
        zoneId: string;
        certificateId: string;
      };
      const data = (await apiRequest(
        getToken(ctx),
        "GET",
        `/zones/${zoneId}/origin_tls_client_auth/${certificateId}`,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction("zoneCertificate.list", {
    access: "read",
    description: "List zone-level origin certificates",
    inputSchema: {
      zoneId: { type: "string", required: true, description: "Zone ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { zoneId, limit } = input as { zoneId: string; limit?: number };
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      const data = (await apiRequest(
        getToken(ctx),
        "GET",
        `/zones/${zoneId}/origin_tls_client_auth`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction("zoneCertificate.upload", {
    access: "write",
    description: "Upload a zone-level origin certificate",
    inputSchema: {
      zoneId: { type: "string", required: true, description: "Zone ID" },
      certificate: {
        type: "string",
        required: true,
        description: "PEM certificate",
      },
      privateKey: {
        type: "string",
        required: true,
        description: "PEM private key",
      },
    },
    async execute(input, ctx) {
      const { zoneId, certificate, privateKey } = input as Record<
        string,
        string
      >;
      const data = (await apiRequest(
        getToken(ctx),
        "POST",
        `/zones/${zoneId}/origin_tls_client_auth`,
        {
          certificate,
          private_key: privateKey,
        },
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction("zoneCertificate.delete", {
    access: "write",
    description: "Delete a zone-level origin certificate",
    inputSchema: {
      zoneId: { type: "string", required: true, description: "Zone ID" },
      certificateId: {
        type: "string",
        required: true,
        description: "Certificate ID",
      },
    },
    async execute(input, ctx) {
      const { zoneId, certificateId } = input as {
        zoneId: string;
        certificateId: string;
      };
      const data = (await apiRequest(
        getToken(ctx),
        "DELETE",
        `/zones/${zoneId}/origin_tls_client_auth/${certificateId}`,
      )) as Record<string, unknown>;
      return data.result;
    },
  });
}
