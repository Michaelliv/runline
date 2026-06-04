import type { RunlinePluginAPI } from "runline";
import { USER_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerUserActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("user.list", "List users in the workspace.", "users", "UserFilter", USER_FIELDS);
  getAction("user.get", "Get a user by ID. Use 'me' to reference the authenticated user.", "user", USER_FIELDS);
  rl.registerAction("user.me", {
    description: "Get the authenticated user.",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = await gql(key(ctx), `query { viewer { ${USER_FIELDS} } }`);
      return data.viewer;
    },
  });
  rl.registerAction("user.update", {
    description: "Update a user. Use id='me' to update the authenticated user.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the user to update. Use 'me' to reference the currently authenticated user" },
      name: { type: "string", required: false, description: "The name of the user" },
      displayName: { type: "string", required: false, description: "The display name of the user" },
      description: { type: "string", required: false, description: "The user description or short bio" },
      avatarUrl: { type: "string", required: false, description: "The avatar image URL of the user" },
      timezone: { type: "string", required: false, description: "The local timezone of the user" },
      title: { type: "string", required: false, description: "The user's job title" },
      statusEmoji: { type: "string", required: false, description: "The emoji part of the user status" },
      statusLabel: { type: "string", required: false, description: "The label part of the user status" },
      statusUntilAt: { type: "string", required: false, description: "When the user status should be cleared (DateTime)" },
    },
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
