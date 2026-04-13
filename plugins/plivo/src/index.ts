import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { authId: c.authId as string, authToken: c.authToken as string };
}

async function apiRequest(
  conn: { authId: string; authToken: string },
  method: string, endpoint: string, body: Record<string, unknown>,
): Promise<unknown> {
  const url = `https://api.plivo.com/v1/Account/${conn.authId}${endpoint}/`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Basic " + btoa(`${conn.authId}:${conn.authToken}`),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Plivo error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function plivo(rl: RunlinePluginAPI) {
  rl.setName("plivo");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    authId: { type: "string", required: true, description: "Plivo Auth ID", env: "PLIVO_AUTH_ID" },
    authToken: { type: "string", required: true, description: "Plivo Auth Token", env: "PLIVO_AUTH_TOKEN" },
  });

  rl.registerAction("sms.send", {
    description: "Send an SMS message via Plivo",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { from, to, message } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "/Message", { src: from, dst: to, text: message });
    },
  });

  rl.registerAction("mms.send", {
    description: "Send an MMS message via Plivo",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true },
      mediaUrls: { type: "string", required: true, description: "Comma-separated media URLs" },
    },
    async execute(input, ctx) {
      const { from, to, message, mediaUrls } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "/Message", { src: from, dst: to, text: message, type: "mms", media_urls: mediaUrls });
    },
  });

  rl.registerAction("call.make", {
    description: "Make a phone call via Plivo",
    inputSchema: {
      from: { type: "string", required: true, description: "Caller number" },
      to: { type: "string", required: true, description: "Destination number" },
      answerUrl: { type: "string", required: true, description: "URL for call answer XML" },
      answerMethod: { type: "string", required: false, description: "HTTP method for answer URL (GET or POST, default POST)" },
    },
    async execute(input, ctx) {
      const { from, to, answerUrl, answerMethod } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "/Call", {
        from, to, answer_url: answerUrl, answer_method: answerMethod ?? "POST",
      });
    },
  });
}
