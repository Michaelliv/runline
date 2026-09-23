import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  registerFileActions,
  registerGroupActions,
  registerMemberActions,
  registerSavedListActions,
} from "./collections.js";
import { registerRecordActions, registerSchemaActions } from "./records.js";

/**
 * Shift Business World Model — an organization's graph of accounts,
 * contacts, opportunities, activities, tasks, notes, and custom object
 * types in the Shift cloud. The API key is the tenant authority; the
 * cloud derives the organization from it (SHFT-852), so no org ID is sent.
 *
 * Every record is an envelope of typed `fields` and typed
 * `relationships`; system keys are $-prefixed; definitions are published
 * per object type and must be read before writing.
 *
 * Requests go through the cloud repo's own BusinessWorldModelClient,
 * vendored under src/vendor (see the SYNCED_FROM headers there), over the
 * shared Shift transport.
 */
export default function shiftBwm(rl: RunlinePluginAPI) {
  rl.setName("shiftBwm");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description:
          "Shift Labs API key. A personal token (subject: user) acts as its human and inherits that person's record visibility; an organization key (subject: service) is its own principal, named on records and added to groups like a member. Needs service:business-world-model:read for reads, :write for record writes, :configure for groups.",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerSchemaActions(rl);
  registerRecordActions(rl);
  registerSavedListActions(rl);
  registerGroupActions(rl);
  registerMemberActions(rl);
  registerFileActions(rl);
}
