import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { shiftWorkersCredential } from "./credentials.js";
import { registerWorkersActions } from "./workers.js";

/**
 * Shift Workers — run Workers-API applications on Shift Cloud: request
 * handlers and Durable Objects with their own SQLite, each application on its
 * own fleet and public URL. The API key is the tenant authority; the cloud
 * derives the organization from it.
 */
export default function shiftWorkers(rl: RunlinePluginAPI) {
  rl.setName("shiftWorkers");
  rl.setVersion("0.1.0");
  rl.setCredential(shiftWorkersCredential);
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description:
          "Shift Labs API key with service:workers:read and service:workers:write",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerWorkersActions(rl);
}
