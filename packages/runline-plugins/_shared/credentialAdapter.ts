import { createHash } from "node:crypto";
import {
  AuthError,
  CredentialRegistry,
  CredentialTransport,
  type ActionContext,
  type CredentialBinding,
  type CredentialBroker,
  type CredentialDeclaration,
  type CredentialSelection,
  type OAuthGrant,
} from "runline";

/**
 * Where one action call's authenticated requests go: the host's broker
 * when it supplies one — the credentials then live with the host, and no
 * local signer is built — else this process signs with its own
 * connection, from the plugin's declaration.
 */
export function credentialBroker(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
): CredentialBroker {
  if (ctx.credentials) return ctx.credentials;
  const { binding, transport } = localSigner(ctx, declaration);
  return {
    request: (input) => transport.request(binding, input),
    probe: () => transport.probe(binding),
  };
}

/** Everything a stored token was issued under. A config whose selection
 *  hashes differently can no longer use tokens issued for this one. */
function authorityOf(selection: CredentialSelection): string {
  return createHash("sha256").update(JSON.stringify(selection)).digest("hex");
}

/**
 * This process signing with its own connection. Flat CLI/env storage is a
 * projection, not a second token cache or refresh engine.
 */
function localSigner(ctx: ActionContext, declaration: CredentialDeclaration) {
  const selection = declaration(ctx.connection.config);
  const { type: definition, method } = selection;
  const identity = { name: ctx.connection.name, plugin: ctx.connection.plugin };
  const expected = authorityOf(selection);
  const project = (current: Readonly<Record<string, unknown>>) => {
    if (authorityOf(declaration(current)) !== expected)
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
    application: selection.application,
    ...(selection.jwtIdentity ? { jwtIdentity: selection.jwtIdentity } : {}),
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
  const transport = new CredentialTransport(registry, {
    fetch: globalThis.fetch,
    maxRequestBytes: 64 * 1024 * 1024,
    maxResponseBytes: 64 * 1024 * 1024,
  });
  return { binding, transport };
}
