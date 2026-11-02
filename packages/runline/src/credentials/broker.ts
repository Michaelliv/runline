import { createHash } from "node:crypto";
import { AuthError } from "../auth/errors.js";
import type { ActionContext } from "../plugin/types.js";
import { awsProfileKey } from "./aws.js";
import { CredentialRegistry } from "./registry.js";
import { type CredentialBroker, CredentialTransport } from "./transport.js";
import type {
  AwsSession,
  CredentialAuthentication,
  CredentialBinding,
  CredentialDeclaration,
  CredentialSelection,
  LocalSecretSource,
  OAuthGrant,
} from "./types.js";

/**
 * Where one action call's authenticated requests go: the host's broker
 * when it supplies one — the credentials then live with the host, and no
 * local signer is built — else this process signs with its own
 * connection, from the plugin's declaration. Plugin-side: the host-side
 * `credentialBroker` option is what supplies `ctx.credentials`.
 */
export function brokerFor(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
): CredentialBroker {
  if (ctx.credentials) return ctx.credentials;
  const { binding, transport } = localSigner(ctx, declaration);
  return {
    request: (input) => transport.request(binding, input),
    probe: () => transport.probe(binding),
    socketUrl: (input) => transport.socketUrl(binding, input),
  };
}

/**
 * Everything a stored token was issued under. A config whose selection
 * hashes differently cannot use tokens issued for this one. A
 * token of a declared grant was issued under the grant — its method,
 * client and token endpoint (Microsoft's names the tenant) — not the
 * plugin that asked, so every plugin of the grant hashes alike and shares
 * it; any other token is the whole selection's, scopes and targets included.
 */
function authorityOf(selection: CredentialSelection): string {
  const { type, method, application } = selection;
  const auth = Object.hasOwn(type.methods, method)
    ? type.methods[method].authentication
    : undefined;
  const issuedUnder =
    auth?.kind === "oauth2" && auth.grant !== undefined
      ? {
          grant: auth.grant,
          method,
          application,
          endpoint: auth.definition.refresh,
        }
      : selection;
  return createHash("sha256").update(JSON.stringify(issuedUnder)).digest("hex");
}

/**
 * A stored secret's structured shape (a static secret's parts, or an AWS
 * access key) from the flat fields and fixed values the declaration
 * names, joined in order where a part concatenates them. Absent when a
 * required part's field is missing, so the transport refuses it as
 * invalid_credentials before any IO; a missing optional part is left out.
 */
function staticSecret(
  current: Readonly<Record<string, unknown>>,
  sources: CredentialSelection["localSecret"],
  optional: readonly string[],
): Record<string, string> | undefined {
  if (!sources) return undefined;
  const secret: Record<string, string> = {};
  for (const [key, source] of Object.entries(sources)) {
    const joined = joinedPart(current, source);
    if (joined !== undefined) secret[key] = joined;
    else if (!optional.includes(key)) return undefined;
  }
  return secret;
}

/**
 * One part of a static secret: its field or fixed value, or the pieces it
 * concatenates joined in order. Absent when any field it reads is missing
 * or not a string.
 */
function joinedPart(
  current: Readonly<Record<string, unknown>>,
  source: LocalSecretSource,
): string | undefined {
  let joined = "";
  for (const part of "concat" in source ? source.concat : [source]) {
    const value = "value" in part ? part.value : current[part.field];
    if (typeof value !== "string") return undefined;
    joined += value;
  }
  return joined;
}

/**
 * How an issued credential is stored flat: an OAuth grant as its token
 * fields, a role session as `awsSession`, each stamped with the authority
 * (`expected`) it was issued under. Only those two are ever renewed and
 * written back.
 */
function writeBack(
  auth: CredentialAuthentication,
  expected: string,
): (
  patch: Record<string, unknown>,
  current: Readonly<Record<string, unknown>>,
) => Record<string, unknown> {
  if (auth.kind === "awsSigV4" && auth.assumeRole) {
    const { sessionField } = auth.assumeRole;
    return (patch) => {
      const session = patch[sessionField] as AwsSession | undefined;
      if (!session?.sessionToken) throw new AuthError("invalid_credentials");
      return { awsSession: { ...session, binding: expected } };
    };
  }
  if (auth.kind !== "oauth2") throw new AuthError("invalid_definition");
  return (patch, current) => {
    const grant = patch[auth.field] as OAuthGrant | undefined;
    if (!grant?.tokens.accessToken) throw new AuthError("invalid_credentials");
    return {
      accessToken: grant.tokens.accessToken,
      accessTokenExpiresAt: grant.tokens.expiresAt,
      refreshToken: grant.tokens.refreshToken ?? current.refreshToken,
      authTokenScope: grant.tokens.scope,
      authTokenType: grant.tokens.tokenType,
      authTokenRevision: grant.revision,
      authTokenBinding: expected,
    };
  };
}

/**
 * This process signing with its own connection. Flat CLI/env storage is a
 * projection, not a second token cache or refresh engine.
 */
function localSigner(ctx: ActionContext, declaration: CredentialDeclaration) {
  const selection = declaration(ctx.connection.config);
  const { type: definition, method } = selection;
  if (!Object.hasOwn(definition.methods, method))
    throw new AuthError("invalid_definition");
  const auth = definition.methods[method].authentication;
  const identity = { name: ctx.connection.name, plugin: ctx.connection.plugin };
  const expected = authorityOf(selection);
  const project = async (current: Readonly<Record<string, unknown>>) => {
    if (authorityOf(declaration(current)) !== expected)
      throw new AuthError("binding_changed");
    if (auth.kind === "none") return {};
    if (auth.kind === "static") {
      const secret = staticSecret(
        current,
        selection.localSecret,
        auth.optionalParts ?? [],
      );
      return secret ? { [auth.field]: secret } : {};
    }
    if (auth.kind === "awsSigV4") {
      const key = selection.awsProfile
        ? await awsProfileKey(selection.awsProfile)
        : staticSecret(current, selection.localSecret, ["sessionToken"]);
      const cached = current.awsSession as
        | (AwsSession & { binding?: string })
        | undefined;
      const sessionField = auth.assumeRole?.sessionField;
      return {
        ...(key ? { [auth.field]: key } : {}),
        ...(sessionField && cached?.binding === expected
          ? {
              [sessionField]: {
                accessKeyId: cached.accessKeyId,
                secretAccessKey: cached.secretAccessKey,
                sessionToken: cached.sessionToken,
                expiresAt: cached.expiresAt,
                revision: cached.revision,
              },
            }
          : {}),
      };
    }
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
    return { [auth.field]: { tokens, revision } };
  };
  const snapshot = async () => ({
    ...identity,
    config: await project(ctx.connection.config),
  });
  const binding: CredentialBinding = {
    type: definition.id,
    method,
    identity,
    application: selection.application,
    ...(selection.jwtIdentity ? { jwtIdentity: selection.jwtIdentity } : {}),
    ...(selection.resourceOwner
      ? { resourceOwner: selection.resourceOwner }
      : {}),
    ...(selection.awsRole ? { awsRole: selection.awsRole } : {}),
    connection: {
      async read() {
        return snapshot();
      },
      async update(change) {
        const flatten = writeBack(auth, expected);
        await ctx.updateConnection(async (current) => {
          const projected = await project(current);
          const patch =
            typeof change === "function" ? await change(projected) : change;
          return patch ? flatten(patch, current) : undefined;
        });
        return snapshot();
      },
    },
  };
  const registry = new CredentialRegistry();
  registry.register(definition);
  // The widest defaults the transport allows, so an undeclared slow call
  // (image generation, exports) is bounded rather than cut short; targets
  // that declare their own deadline or ceiling get it up to the host caps.
  const transport = new CredentialTransport(registry, {
    fetch: globalThis.fetch,
    timeoutMs: 120_000,
    maxRequestBytes: 64 * 1024 * 1024,
    maxResponseBytes: 64 * 1024 * 1024,
  });
  return { binding, transport };
}
