import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  bindGetAction,
  bindListAction,
  CYCLE_FIELDS,
  gql,
  key,
  requireUnscoped,
} from "./shared.js";

export function registerCycleActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction(
    "cycle.list",
    "List cycles. Use filter for isActive/isNext/isPrevious.",
    "cycles",
    "CycleFilter",
    CYCLE_FIELDS,
  );
  getAction("cycle.get", "Get a cycle by ID.", "cycle", CYCLE_FIELDS);
  rl.registerAction("cycle.create", {
    access: "write",
    description: "Create a cycle for a team.",
    inputSchema: t.Object({
      teamId: t.String({ description: "The team to associate the cycle with" }),
      startsAt: t.String({
        description: "The start time of the cycle (DateTime, ISO 8601)",
      }),
      endsAt: t.String({
        description: "The end time of the cycle (DateTime, ISO 8601)",
      }),
      name: t.Optional(
        t.String({ description: "The custom name of the cycle" }),
      ),
      description: t.Optional(
        t.String({ description: "The description of the cycle" }),
      ),
      completedAt: t.Optional(
        t.String({
          description:
            "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed",
        }),
      ),
      id: t.Optional(
        t.String({
          description:
            "The identifier in UUID v4 format. If none is provided, the backend will generate one",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "cycles.*");
      const data = await gql(
        key(ctx),
        `mutation($input: CycleCreateInput!) { cycleCreate(input: $input) { success cycle { ${CYCLE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.cycleCreate as Record<string, unknown>)?.cycle;
    },
  });
  rl.registerAction("cycle.update", {
    access: "write",
    description: "Update a cycle.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the cycle to update" }),
      name: t.Optional(
        t.String({ description: "The custom name of the cycle" }),
      ),
      description: t.Optional(
        t.String({ description: "The description of the cycle" }),
      ),
      startsAt: t.Optional(
        t.String({
          description: "The start time of the cycle (DateTime, ISO 8601)",
        }),
      ),
      endsAt: t.Optional(
        t.String({
          description: "The end time of the cycle (DateTime, ISO 8601)",
        }),
      ),
      completedAt: t.Optional(
        t.String({
          description:
            "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "cycles.*");
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: CycleUpdateInput!) { cycleUpdate(id: $id, input: $input) { success cycle { ${CYCLE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.cycleUpdate as Record<string, unknown>)?.cycle;
    },
  });
  // Archive is the only way to remove a single cycle: Linear has no
  // per-cycle delete mutation. Issues are unlinked from the cycle first,
  // they are not archived with it.
  rl.registerAction("cycle.archive", {
    access: "write",
    description:
      "Archive one cycle. Issues assigned to it are unlinked from the cycle first, not archived. This is the per-cycle removal; Linear has no single-cycle delete.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the cycle to archive" }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "cycles.*");
      const { id } = input as { id: string };
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { cycleArchive(id: $id) { success } }`,
        { id },
      );
      return data.cycleArchive;
    },
  });

  // Deliberately NOT named cycle.delete.
  //
  // Linear's teamCyclesDelete takes a *team* id and wipes every cycle that
  // team has, disabling the cycles feature entirely. Exposing it as
  // `cycle.delete({ id })` would read as "delete this one cycle" and let an
  // agent destroy a team's whole cycle history by analogy with every other
  // `*.delete` action in this plugin. The name and the parameter both say
  // team, and the description leads with the blast radius.
  rl.registerAction("team.cyclesDeleteAll", {
    access: "write",
    description:
      "DESTRUCTIVE: delete ALL cycle data for a team and disable the cycles feature. Removes every cycle and its issue associations, not just one. To remove a single cycle use cycle.archive.",
    inputSchema: t.Object({
      teamId: t.String({
        description:
          "The identifier of the TEAM whose cycles will all be deleted",
      }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "cycles.*");
      const { teamId } = input as { teamId: string };
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { teamCyclesDelete(id: $id) { success } }`,
        { id: teamId },
      );
      return data.teamCyclesDelete;
    },
  });
}
