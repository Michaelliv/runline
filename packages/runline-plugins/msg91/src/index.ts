import type { RunlinePluginAPI } from "runline";

export default function msg91(rl: RunlinePluginAPI) {
  rl.setName("msg91");
  rl.setVersion("0.1.0");

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
      const authkey = ctx.connection.config.authkey as string;
      const url = new URL("https://api.msg91.com/api/sendhttp.php");
      url.searchParams.set("authkey", authkey);
      url.searchParams.set("route", "4");
      url.searchParams.set("country", "0");
      url.searchParams.set("sender", from as string);
      url.searchParams.set("mobiles", to as string);
      url.searchParams.set("message", message as string);
      const res = await fetch(url.toString());
      if (!res.ok)
        throw new Error(`MSG91 API error ${res.status}: ${await res.text()}`);
      const text = await res.text();
      return { requestId: text };
    },
  });
}
