import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api-eu.dhl.com";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: { "DHL-API-Key": apiKey, Accept: "application/json" },
  });
  if (!res.ok)
    throw new Error(`DHL API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function dhl(rl: RunlinePluginAPI) {
  rl.setName("dhl");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "DHL API key",
      env: "DHL_API_KEY",
    },
  });

  rl.registerAction("shipment.track", {
    access: "read",
    description: "Get tracking details for a shipment",
    inputSchema: {
      trackingNumber: {
        type: "string",
        required: true,
        description: "DHL tracking number",
      },
      recipientPostalCode: {
        type: "string",
        required: false,
        description: "Recipient postal code for more detailed info",
      },
    },
    async execute(input, ctx) {
      const { trackingNumber, recipientPostalCode } = input as Record<
        string,
        unknown
      >;
      const apiKey = ctx.connection.config.apiKey as string;
      const qs: Record<string, unknown> = { trackingNumber };
      if (recipientPostalCode) qs.recipientPostalCode = recipientPostalCode;
      const data = (await apiRequest(
        apiKey,
        "GET",
        "/track/shipments",
        qs,
      )) as Record<string, unknown>;
      return data.shipments;
    },
  });
}
