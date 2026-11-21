import { credentialJson, type CodemodePluginAPI } from "@shiftlabs/codemode";
import { mailcheckCredential } from "./credentials.js";

export default function mailcheck(rl: CodemodePluginAPI) {
  rl.setName("mailcheck");
  rl.setVersion("0.1.0");
  rl.setCredential(mailcheckCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Mailcheck API key",
      env: "MAILCHECK_API_KEY",
    },
  });

  rl.registerAction("email.check", {
    access: "write",
    description: "Verify an email address",
    inputSchema: {
      email: {
        type: "string",
        required: true,
        description: "Email address to check",
      },
    },
    async execute(input, ctx) {
      const { email } = input as { email: string };
      return credentialJson(ctx, mailcheckCredential, "mailcheck", {
        target: "api",
        path: "v1/singleEmail:check",
        method: "POST",
        json: { email },
      });
    },
  });
}
