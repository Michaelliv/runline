import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  registerFileActions,
  registerGroupActions,
  registerListActions,
  registerMemberActions,
} from "./collections.js";
import { registerRecordActions, registerSchemaActions } from "./records.js";
import { DEFAULT_BASE_URL } from "./shared.js";

/**
 * Shift Business World Model: an organization's graph of accounts,
 * contacts, opportunities, activities, tasks, notes, and custom object
 * types, served by Shift Cloud at /v1/services/business-world-model.
 *
 * Lightfield-shaped: every record is an envelope of typed `fields` and
 * typed `relationships`; system keys are $-prefixed; definitions are
 * published per object type and must be read before writing.
 *
 * Transport is the cloud repo's own BusinessWorldModelClient, vendored
 * under src/vendor (see the SYNCED_FROM headers there).
 */
export default function shiftBwm(rl: RunlinePluginAPI) {
  rl.setName("shiftBwm");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description:
          "Shift Cloud API key (sk_live_...). A personal token (subject: user) makes the agent act as its human and inherit that person's record visibility; an organization key (subject: service) is its own principal, named on records and added to groups like a member. Needs service:business-world-model:read for reads, :write for record writes, :configure for groups.",
        env: "SHIFT_BWM_API_KEY",
      }),
      baseUrl: t.Optional(
        t.String({
          description: `Shift Cloud API origin. Default ${DEFAULT_BASE_URL}; set to the dev or a local API to test against another environment.`,
          env: "SHIFT_API_URL",
        }),
      ),
    }),
  );

  registerSchemaActions(rl);
  registerRecordActions(rl);
  registerListActions(rl);
  registerGroupActions(rl);
  registerMemberActions(rl);
  registerFileActions(rl);
}
