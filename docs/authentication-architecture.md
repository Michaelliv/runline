# Authentication architecture

## Ownership

Runline owns service authentication definitions and protocol execution. The embedding
host owns identity, authorization, account bindings, secret custody, and coordination.
A credential's resolution and lifecycle writes must use the same authority.

The target model separates:

- **Credential type:** schema, authentication method, provider behavior, safe probe.
- **OAuth application registration:** client identity and allowed redirect URIs.
- **Credential instance:** connected account, encrypted grant, token revision.
- **Connection:** plugin, non-secret settings, credential references.
- **Binding:** which connection an execution is authorized to use.

Sharing an OAuth application does not imply sharing an account or grant. Granted
scopes and resource/audience remain properties of the grant. Provider identity is
declared, not inferred from endpoint URLs.

## Implemented foundation: host-owned connection providers

`Runline.create({ connections })` uses process-local `MemoryConnectionProvider`.
It does not read environment hints or write `.runline/config.json`. Its initial data
and returned snapshots are copied. Updates survive engine disposal/recreation.

An embedder instead supplies `connectionProvider`. `connections` and
`connectionProvider` are mutually exclusive. The provider resolves on every action
invocation, after input validation, using plugin/action metadata and host-supplied
`execute(..., { context })`. It returns a handle bound to one account. Reads and
writes use that handle; rejection never falls back to ambient credentials.

```ts
const runline = Runline.create({
  plugins,
  connectionProvider: hostConnections,
});

await runline.execute(code, {
  context: authenticatedExecutionContext,
});
```

The host must authorize this context; it is not an agent argument. Do not use a
plugin name alone as a shared credential-store key. Resolve an exact tenant/account
identity and keep the handle bound to it for the invocation.

`runline.connections()` enumerates only the SDK's own in-memory connections. A
host-managed provider is not enumerated: the host supplies its authorized metadata
listing. Configure additional host-managed connections through that host, not
`addPlugin(..., connections)`.

### Coordinated updates

Existing `ctx.updateConnection({ ...patch })` persists through the provider. The
action's snapshot advances only after a successful write.

Refresh-sensitive code uses an updater instead:

```ts
await ctx.updateConnection(async (current) => {
  if (tokenIsUsable(current)) return;
  const result = await refreshAtProvider(current);
  return validatedTokenPatch(result, current);
});
```

The provider must acquire ownership, re-read, invoke the callback once, commit,
and return the current snapshot. Returning `undefined` makes no write, but returns
the fresh state, including a token another caller refreshed. Throwing aborts the
write and releases ownership. Callbacks must not recursively update the same store.

All writers sharing an identity must participate in the same coordination domain.
Distributed adapters must fence lifecycle changes and stale lock holders. A CAS
write alone does not prevent two callers spending the same rotating refresh token.
Do not fall back to unlocked refresh or automatically retry an updater.

A callback is trusted host-side code, not a serializable RPC. An IPC broker cannot
receive arbitrary callbacks to execute with server authority. It implements the
operation server-side, using approved auth definitions and constrained requests.

### Local adapters

- `MemoryConnectionProvider`: serializes async updates per connection. Share the
  same provider object across SDK instances to share state and coordination.
- `FileConnectionProvider(absoluteConfigPath)`: CLI-oriented plaintext storage.
  Pins its path at construction, resolves schema environment hints, holds a
  renewable file-wide lock across the complete update, and writes by atomic rename
  with mode 0600. Missing connections are not implicitly recreated on update.
  Invalid files fail closed. Lock failure never falls back to an unlocked write.

The CLI and `Runline.fromProject(path)` explicitly select the file adapter. Direct
`ExecutionEngine` use defaults to memory, just like the SDK. This changes the
implicit-disk/ambient-environment behavior of direct SDK/engine construction;
embedders wanting it must opt into the file provider.

Config creation, replacement, connection add/remove, administrative patches, and
runtime updates share one file transaction implementation. `saveConfig`,
`addConnection`, and `removeConnection` are now asynchronous; callers must await
them. Administrative patches reject missing connections. Readers and writers reject
malformed config instead of treating it as empty. Environment hints fill nullish
values, not explicit empty strings, false, or zero.

Reconnect and whole-config replacement assign fresh connection generations. Handles
from an earlier login cannot read or update the replacement account. A handle
resolved without an account never attaches to an account added afterward. Manual
file editors do not participate in locking or generation fencing. Atomic rename
is not a distributed transaction or a guarantee against machine power loss. Hosted
credential custody should use an authoritative service, not workspace files.

## Implemented protocol slice: OAuth2 definitions and token runtime

`OAuth2Definition` describes one provider protocol without embedding an application
registration or credential instance. It declares explicit `id` and `provider`, an
optional authorization endpoint, and separately optional code-exchange, refresh,
and client-credentials operations. Unsupported operations fail explicitly.

Each token operation declares its endpoint, form/JSON encoding, client authentication
(none, client ID only, Basic, or body secret), optional grant-type override/omission,
provider-specific parameters, and token response field/envelope mapping. Protocol-owned
parameters cannot be overwritten by definition extras or endpoint query parameters.
The host supplies `OAuthApplication`, redirect URI, state, PKCE material and scopes.
Definitions are trusted configuration, not authority supplied by workspace code.

Exports: `buildOAuth2AuthorizationUrl`, `exchangeOAuth2Code`, `refreshOAuth2Token`,
`acquireOAuth2ClientToken`, and the low-level `requestOAuth2Token`/`decodeOAuthTokens`.
The low-level request takes fully assembled parameters (including custom JWT grants);
it does not apply high-level operation defaults. The CLI's existing `OAuthConfig`
API is an adapter retaining its body-auth default, not a separate exchange engine.
Google, Microsoft, PayPal, HaloPSA, Bitwarden, and Salesforce use the same token
transport and decoder. Cached tokens belong to each resolved connection, not a
module-global cache. Salesforce acquires request-local client-credential sessions;
its instance URL and identity fields use an explicit response metadata allowlist.
Provider metadata outside that allowlist is discarded. Self-hosted token endpoints
must use HTTPS too.

`OAuthTokens.refreshToken` and `expiresAt` are optional. Missing expiry is unknown,
not immediately expired. A refresh preserves an omitted replacement refresh token,
scope, token type and selected provider metadata, but never inherits the previous
access token's expiry. Expiry is measured from request start, so response latency
does not extend a token's lifetime.
The flat-config Google/Microsoft adapters explicitly clear old expiry on renewal
and reuse unknown-expiry tokens. Refresh-on-auth-rejection belongs to the upcoming
authenticated transport slice.

The protocol runtime is storage-independent: callers run refresh **inside** their
resolved handle's update callback and commit the returned grant before using it.
It neither acquires a second lock nor writes a separate store. No callback or network
request is automatically retried. A provider may rotate a token before persistence
fails; the host must surface that failure.

Token requests require HTTPS without URL credentials/fragments, refuse redirects,
have a bounded timeout and response size, and produce `AuthError` codes without raw
response bodies, parser diagnostics, request details or nested causes. `invalid_grant`
becomes `reconnect_required`; a network error does not establish whether a rotating
token was consumed. Protocol events contain only definition/provider IDs, operation,
result and safe error code. `issued` means issued by the provider, **not persisted**.

The local CLI binds its callback listener before publishing the consent URL. It
validates state before accepting either success or provider denial, ignores unbound
callbacks, redacts provider errors, and releases the listener on timeout or launch
failure. This local lifecycle is not durable hosted setup. Connection listings expose
field names but redact every value, including short and nested values.

Hosts must approve definitions and enforce egress/SSRF policy using the supplied
transport hook. HTTPS validation alone is not an SSRF boundary. These primitives
are not safe authenticated capabilities for untrusted workspace code. Hosted callback
registration, state custody, PKCE enforcement, cancellation and one-time consumption
remain the setup lifecycle's responsibility. No live provider behavior is inferred
from mocked protocol tests.

## Remaining implementation stages

These slices are not yet the complete credential architecture. Plugins still receive
raw configuration. The generic credential-type registry, authenticated transport,
durable setup lifecycle and privileged broker are not implemented.

1. **Credential definitions and lifecycle integration:** compose reusable credential
   types with connection schemas, explicit auth-method selection and declared safe
   probes; integrate the OAuth2 protocol with grant custody and other methods such
   as API keys and signed service-account assertions. Standard protocols are
   implementations, not assumptions imposed on every provider.
2. **Authenticated transport:** approved destinations, header injection, bounded
   refresh-on-auth-rejection and replay-safe retry. No general automatic write
   retry; request bodies and provider semantics determine replay safety.
3. **Setup lifecycle:** PKCE/state, host-supplied application registration and
   callback URI, durable expiring flow storage, atomic consume-once completion,
   cancellation and reconnect fencing. Never execute arbitrary plugin setup code
   in a privileged host merely because it declares OAuth.
4. **Vex broker:** encrypted authoritative grants, user/workspace bindings, scoped
   IPC, and revision-aware invalidation. Token renewal must not restart workspace
   hosts. Authorization changes must take effect according to explicit policy.
5. **Provider migrations:** Plaud as a nonstandard refresh test case, then move
   Google/Microsoft from their coordinated helpers onto declarative auth definitions.
   Converge AI-provider lifecycle infrastructure without replacing
   provider SDK adapters or inference-routing policy.

## Security and failure invariants

- Raw credentials belong only in trusted runtimes. Runline's JS worker is not a
  security sandbox. Untrusted Vex workspace code receives constrained authenticated
  request capabilities, not a vault handle or long-lived refresh tokens.
- The broker derives/verifies identity independently of fields sent by workspace
  code. Enforce connection use, destinations, credential compatibility, and action
  policy. A generic authenticated arbitrary-URL proxy is not an adequate boundary.
- Administrative enablement, authorization state, operational health, and capacity
  cooldown are separate dimensions. An expired but refreshable token is connected.
- Disable, unbind, disconnect locally, revoke remotely, and delete are distinct.
- Storage failure after provider rotation is an explicit failure. Never claim the
  new refresh token is persisted when it is not. A timeout may mean the provider
  consumed the old token; blind repetition can make recovery worse.
- A stale in-flight refresh must not undo a disconnect or overwrite a newer login.
- Test credentials with declared safe probes, never the first arbitrary action.
- Never expose provider token response bodies or secret-bearing context in agent
  errors, traces, setup status, or metadata listings.

## Evidence

Reference research: n8n `c2a27339`, Vex `8205e3a0`, Runline `0.29.0`.

n8n's useful precedents are credential type composition, `CredentialsHelper`,
context-aware dynamic resolution/writeback, `requestOAuth2`, and per-credential
single-flight plus leases. Do not copy its unlocked lease-timeout fallback or assume
its separate cache read/delete is atomically consume-once. This implementation is
original Runline code, not copied n8n implementation.

Vex already has credential IDs, encrypted bundles, bindings, health/cooldowns and
refresh sweeps for inference credentials, and a constrained server/workspace-host
pipe. Action integrations currently use encrypted named secrets materialized into
host environments, while Runline's old refresh path writes local config. The broker
must close that custody loop without moving workspace-authored code into the server.
