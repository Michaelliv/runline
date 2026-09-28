import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { dhlCredential } from "./credentials.js";

export default function dhl(rl: RunlinePluginAPI) {
  rl.setName("dhl");
  rl.setVersion("0.1.0");
  rl.setCredential(dhlCredential);

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
      const qs: Record<string, unknown> = { trackingNumber };
      if (recipientPostalCode) qs.recipientPostalCode = recipientPostalCode;
      const data = (await credentialJson(ctx, dhlCredential, "dhl", {
        target: "api",
        path: "track/shipments",
        query: qs,
      })) as Record<string, unknown>;
      return data.shipments;
    },
  });
}
