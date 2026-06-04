import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { USER_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerUserActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("user.list", "List users in the workspace.", "users", "UserFilter", USER_FIELDS);
  getAction("user.get", "Get a user by ID. Use 'me' to reference the authenticated user.", "user", USER_FIELDS);
  rl.registerAction("user.me", {
    description: "Get the authenticated user.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      const data = await gql(key(ctx), `query { viewer { ${USER_FIELDS} } }`);
      return data.viewer;
    },
  });
  rl.registerAction("user.update", {
    description: "Update a user. Use id='me' to update the authenticated user.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the user to update. Use 'me' to reference the currently authenticated user" }),
      name: t.Optional(t.String({ description: "The name of the user" })),
      displayName: t.Optional(t.String({ description: "The display name of the user" })),
      description: t.Optional(t.String({ description: "The user description or short bio" })),
      avatarUrl: t.Optional(t.String({ description: "The avatar image URL of the user" })),
      timezone: t.Optional(t.String({ description: "The local timezone of the user" })),
      title: t.Optional(t.String({ description: "The user's job title" })),
      statusEmoji: t.Optional(t.String({ description: "The emoji part of the user status" })),
      statusLabel: t.Optional(t.String({ description: "The label part of the user status" })),
      statusUntilAt: t.Optional(t.String({ description: "When the user status should be cleared (DateTime)" })),
    }),
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: UserUpdateInput!) { userUpdate(id: $id, input: $input) { success user { ${USER_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.userUpdate as Record<string, unknown>)?.user;
    },
  });
}
