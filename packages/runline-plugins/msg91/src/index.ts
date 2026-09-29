import type { RunlinePluginAPI } from "runline";
import { credentialOk } from "../../_shared/credentials.js";
import { msg91Credential } from "./credentials.js";

export default function msg91(rl: RunlinePluginAPI) {
  rl.setName("msg91");
  rl.setVersion("0.1.0");
  rl.setCredential(msg91Credential);

  rl.setConnectionSchema({
    authkey: {
      type: "string",
      required: true,
      description: "MSG91 auth key",
      env: "MSG91_AUTHKEY",
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send a transactional SMS via MSG91",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender ID" },
      to: {
        type: "string",
        required: true,
        description: "Recipient number with country code",
      },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { from, to, message } = input as Record<string, unknown>;
      // The response body is a bare request ID, not JSON.
      const res = await credentialOk(ctx, msg91Credential, "msg91", {
        target: "api",
        path: "sendhttp.php",
        query: {
          route: "4",
          country: "0",
          sender: from,
          mobiles: to,
          message,
        },
      });
      const text = await res.text();
      return { requestId: text };
    },
  });
}
