import type { RunlinePluginAPI } from "runline";

export default function mailcheck(rl: RunlinePluginAPI) {
  rl.setName("mailcheck");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Mailcheck API key", env: "MAILCHECK_API_KEY" },
  });

  rl.registerAction("email.check", {
    description: "Verify an email address",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address to check" },
    },
    async execute(input, ctx) {
      const { email } = input as { email: string };
      const res = await fetch("https://api.mailcheck.co/v1/singleEmail:check", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.connection.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`Mailcheck API error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
