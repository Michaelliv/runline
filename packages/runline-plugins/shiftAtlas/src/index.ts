import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerGraphActions } from "./graph.js";

/**
 * Shift Atlas — the operational graph of a Shift cloud organization:
 * the map of how the business runs. Independent of the shiftLabs
 * plugin the same way shiftCrm is, but authenticated with the same
 * Shift cloud API key; the cloud derives the organization from the
 * key, so no organization ID is ever sent (SHFT-852).
 */
export default function shiftAtlas(rl: RunlinePluginAPI) {
  rl.setName("shiftAtlas");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      // Same Shift Labs API key family as the shiftLabs plugin; needs
      // the service:operational-graph:use scope.
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerGraphActions(rl);
}
