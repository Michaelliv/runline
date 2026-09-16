import { createHash } from "node:crypto";
import {
  AuthError,
  CredentialRegistry,
  CredentialTransport,
  type ActionContext,
  type CredentialBinding,
  type CredentialType,
  type OAuthGrant,
} from "runline";

/** Flat CLI/env storage is a projection, not a second token cache or refresh engine. */
export function credentialRuntime(
  ctx: ActionContext,
  definition: CredentialType,
  method: string,
  authority: (config: Readonly<Record<string, unknown>>) => unknown,
) {
  const identity = { name: ctx.connection.name, plugin: ctx.connection.plugin };
  const fingerprint = (config: Readonly<Record<string, unknown>>) =>
    createHash("sha256")
      .update(JSON.stringify([definition.id, method, authority(config)]))
      .digest("hex");
  const expected = fingerprint(ctx.connection.config);
  const project = (current: Readonly<Record<string, unknown>>) => {
    if (fingerprint(current) !== expected)
      throw new AuthError("binding_changed");
    const compatible =
      current.authTokenBinding === undefined ||
      current.authTokenBinding === expected;
    const tokens = {
      ...(compatible && current.accessToken !== undefined
        ? { accessToken: current.accessToken }
        : {}),
      ...(current.refreshToken !== undefined
        ? { refreshToken: current.refreshToken }
        : {}),
      ...(compatible && current.accessTokenExpiresAt !== undefined
        ? { expiresAt: current.accessTokenExpiresAt }
        : {}),
      ...(compatible && current.authTokenScope !== undefined
        ? { scope: current.authTokenScope }
        : {}),
      ...(compatible && current.authTokenType !== undefined
        ? { tokenType: current.authTokenType }
        : {}),
    };
    if (!Object.keys(tokens).length) return {};
    const revision =
      typeof current.authTokenRevision === "string" && compatible
        ? current.authTokenRevision
        : createHash("sha256").update(JSON.stringify(tokens)).digest("hex");
    return { grant: { tokens, revision } };
  };
  const snapshot = () => ({
    ...identity,
    config: project(ctx.connection.config),
  });
  const binding: CredentialBinding = {
    type: definition.id,
    method,
    identity,
    application: {
      clientId: ctx.connection.config.clientId as string,
      clientSecret: ctx.connection.config.clientSecret as string | undefined,
    },
    connection: {
      async read() {
        return snapshot();
      },
      async update(change) {
        await ctx.updateConnection(async (current) => {
          const projected = project(current);
          const patch =
            typeof change === "function" ? await change(projected) : change;
          if (!patch) return;
          const grant = patch.grant as OAuthGrant;
          if (!grant?.tokens.accessToken)
            throw new AuthError("invalid_credentials");
          return {
            accessToken: grant.tokens.accessToken,
            accessTokenExpiresAt: grant.tokens.expiresAt,
            refreshToken: grant.tokens.refreshToken ?? current.refreshToken,
            authTokenScope: grant.tokens.scope,
            authTokenType: grant.tokens.tokenType,
            authTokenRevision: grant.revision,
            authTokenBinding: expected,
          };
        });
        return snapshot();
      },
    },
  };
  const registry = new CredentialRegistry();
  registry.register(definition);
  // Builtins run in the caller's trusted runtime. Vex must supply its privileged
  // egress transport via the broker rather than execute these plugins server-side.
  const transport = new CredentialTransport(registry, {
    fetch: globalThis.fetch,
    maxRequestBytes: 64 * 1024 * 1024,
    maxResponseBytes: 64 * 1024 * 1024,
  });
  return { binding, transport };
}
