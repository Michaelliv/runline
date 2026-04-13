import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { accountSid: c.accountSid as string, authToken: c.authToken as string };
}

async function apiRequest(
  conn: ReturnType<typeof getConn>, method: string, endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${conn.accountSid}${endpoint}`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) { if (v !== undefined && v !== null && v !== "") form.set(k, String(v)); }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${conn.accountSid}:${conn.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!res.ok) throw new Error(`Twilio error ${res.status}: ${await res.text()}`);
  return res.json();
}

function escapeXml(str: string): string {
  return str.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch] || ch);
}

export default function twilio(rl: RunlinePluginAPI) {
  rl.setName("twilio");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accountSid: { type: "string", required: true, description: "Twilio Account SID", env: "TWILIO_ACCOUNT_SID" },
    authToken: { type: "string", required: true, description: "Twilio Auth Token", env: "TWILIO_AUTH_TOKEN" },
  });

  rl.registerAction("sms.send", {
    description: "Send an SMS, MMS, or WhatsApp message",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender phone number" },
      to: { type: "string", required: true, description: "Recipient phone number" },
      body: { type: "string", required: true, description: "Message text" },
      whatsapp: { type: "boolean", required: false, description: "Send via WhatsApp" },
      statusCallback: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      let from = p.from as string;
      let to = p.to as string;
      if (p.whatsapp) { from = `whatsapp:${from}`; to = `whatsapp:${to}`; }
      return apiRequest(getConn(ctx), "POST", "/Messages.json", {
        From: from, To: to, Body: p.body, StatusCallback: p.statusCallback,
      });
    },
  });

  rl.registerAction("call.make", {
    description: "Make a phone call",
    inputSchema: {
      from: { type: "string", required: true },
      to: { type: "string", required: true },
      message: { type: "string", required: true, description: "Text to speak or TwiML" },
      twiml: { type: "boolean", required: false, description: "If true, message is treated as raw TwiML" },
      statusCallback: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const twiml = p.twiml
        ? p.message as string
        : `<Response><Say>${escapeXml(p.message as string)}</Say></Response>`;
      return apiRequest(getConn(ctx), "POST", "/Calls.json", {
        From: p.from, To: p.to, Twiml: twiml, StatusCallback: p.statusCallback,
      });
    },
  });
}
