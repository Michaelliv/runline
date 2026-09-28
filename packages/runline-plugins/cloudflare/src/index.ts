import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { cloudflareCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, cloudflareCredential, "cloudflare", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

export default function cloudflare(rl: RunlinePluginAPI) {
  rl.setName("cloudflare");
  rl.setVersion("0.1.0");
  rl.setCredential(cloudflareCredential);

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
        ctx,
        "GET",
        `zones/${seg(zoneId)}/origin_tls_client_auth/${seg(certificateId)}`,
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
        ctx,
        "GET",
        `zones/${seg(zoneId)}/origin_tls_client_auth`,
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
        ctx,
        "POST",
        `zones/${seg(zoneId)}/origin_tls_client_auth`,
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
        ctx,
        "DELETE",
        `zones/${seg(zoneId)}/origin_tls_client_auth/${seg(certificateId)}`,
      )) as Record<string, unknown>;
      return data.result;
    },
  });
}
