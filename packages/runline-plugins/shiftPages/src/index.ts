import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerPageActions } from "./pages.js";

/**
 * Shift Pages — hosted HTML pages in the Shift cloud: draft, publish,
 * archive, share with invited viewers, and resolve authenticated
 * render URLs. The API key is the tenant authority; the cloud derives
 * the organization from it (SHFT-852), so no org ID is sent.
 */
export default function shiftPages(rl: RunlinePluginAPI) {
  rl.setName("shiftPages");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerPageActions(rl);
}
