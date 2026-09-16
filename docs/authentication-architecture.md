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
client-credentials, and RS256 JWT-bearer operations. Unsupported operations fail explicitly.

Each token operation declares its endpoint, form/JSON encoding, client authentication
(none, client ID only, Basic, or body secret), optional grant-type override/omission,
provider-specific parameters, and token response field/envelope mapping. Protocol-owned
parameters cannot be overwritten by definition extras or endpoint query parameters.
The host supplies `OAuthApplication`, redirect URI, state, PKCE material and scopes.
Definitions are trusted configuration, not authority supplied by workspace code.

Exports: `buildOAuth2AuthorizationUrl`, `exchangeOAuth2Code`, `refreshOAuth2Token`,
`acquireOAuth2ClientToken`, `acquireOAuth2JwtToken`, and the low-level
`requestOAuth2Token`/`decodeOAuthTokens`.
The low-level request takes fully assembled parameters (including custom JWT grants);
it does not apply high-level operation defaults. The CLI's existing `OAuthConfig`
API is an adapter retaining its body-auth default, not a separate exchange engine.
Plugins can opt into `OAuthConfig.protocol` for the same explicit provider definition
used by the credential transport. Protocol and flat endpoint declarations are mutually
exclusive: no duplicate endpoints or parameter precedence. Exchange declarations can
require PKCE and request that the host-validated state be sent again; this does not
replace callback validation. Both setup primitives and the credential registry use
the same boolean-policy validation.
Google, Microsoft, Plaud, PayPal, HaloPSA, Bitwarden, and Salesforce use the same token
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
and reuse unknown-expiry tokens. Refresh-on-auth-rejection is implemented in the
opt-in credential transport below; legacy plugin helpers do not acquire it automatically.

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

The local CLI pins configuration, application credentials, and launch hooks before
awaiting consent, for both protocol and flat declarations. It binds its callback
listener before publishing the consent URL, validates state before accepting either
success or provider denial, ignores unbound callbacks, redacts provider errors, and
releases the listener on timeout or launch failure. Delayed consent publication cannot
launch a browser after the flow finishes. This local lifecycle is not durable hosted setup. Connection listings expose
field names but redact every value, including short and nested values.

Hosts must approve definitions and enforce egress/SSRF policy using the supplied
transport hook. HTTPS validation alone is not an SSRF boundary. These primitives
are not safe authenticated capabilities for untrusted workspace code. Hosted callback
registration, state custody, PKCE enforcement, cancellation and one-time consumption
remain the setup lifecycle's responsibility. No live provider behavior is inferred
from mocked protocol tests.

## Implemented credential definitions and constrained transport

`CredentialRegistry` stores detached, host-approved `CredentialType` declarations.
Each named method supplies a strict TypeBox object schema, an explicit authentication
strategy (`apiKey`, `bearer`, or `oauth2`), named API targets, and an optional fixed
GET/HEAD probe. No method is selected by default or inferred from populated fields.
Duplicate type registration is rejected; registry reads return detached copies.
Definitions compose through ordinary TypeScript objects and shared schemas, not
runtime inheritance or executable expressions. API-key injection is header-only;
OAuth2 resource requests currently support Bearer tokens only. JWT-bearer issuance uses a host-selected `OAuthJwtIdentity` (issuer, RSA private
key, optional subject), fixed endpoint audience, declared scopes, and a one-hour
RS256 assertion. RSA keys must be at least 2048 bits. Resource signing methods
beyond Bearer require future implementations, not privileged plugin callbacks.

`CredentialTransport.request(binding, request)` accepts a host-authorized binding:
credential type, explicit method, expected connection identity, a resolved
`ConnectionHandle`, and optional host-selected OAuth application or JWT identity. The method schema
validates the handle's config without secret-bearing validation messages. The host
must resolve and authorize bindings per invocation; the transport does not infer
identity or authorization from a plugin name. It does not register itself in the
worker or automatically migrate existing plugin actions.

OAuth methods name a `grantField`, holding an `OAuthGrant`:
`{ tokens: Partial<OAuthTokens>, revision: string }`. Setup can seed only a refresh
token; issuance must supply an access token. Use `OAuthGrantSchema` in the method
schema; make the field optional for initial client-credentials/JWT acquisition. Seed a
fresh revision when saving setup tokens. Every writer replacing a grant must change
its revision; reconnect/application/method changes also require lifecycle fencing.
The explicit renewal strategy is `refresh`, `clientCredentials`, or `jwtBearer`. All acquire
ownership via the existing handle, reread, request tokens, and commit before use.
A fresh revision coalesces stale rejections even when the provider repeats its token
value. There is no module-global token cache, second lock, unlocked fallback, or
automatic replay of a failed refresh. Unknown expiry stays usable until rejection;
known expiry has a 60-second proactive skew.

Targets declare exact HTTPS base URLs ending in `/`, allowed HTTP methods, optional
additional caller-set headers, and optional provider idempotency contracts. Requests
supply a target name and relative path—not an origin. Absolute URLs, traversal,
ambiguous encoded path segments, fragments, undeclared headers, credential overrides,
and redirects are rejected. Accept and Content-Type are caller-set by default;
authentication and declared idempotency headers are transport-owned. Credentials
never move into URLs. No ambient cookies are sent or returned as Set-Cookie headers.
The injected host `fetch` is mandatory and serves **both token and resource requests**.
It must enforce DNS/IP egress policy, TLS, redirect refusal, and cancellation. Exact
URL restrictions do not by themselves prevent DNS rebinding, private-address access,
or server-side URL fetching driven by API parameters.

Resource requests buffer copied string/byte bodies (default 1 MiB, maximum 64 MiB)
and bounded responses (default 8 MiB, maximum 64 MiB); streams and FormData are not
accepted. Each resource attempt has a timeout spanning headers and body (default
20 seconds, maximum 120 seconds). OAuth calls have their own protocol timeout. Host
storage ownership may have a separate deadline. HTTP responses are returned as
buffered `Response` objects; their bodies are application data, not automatically
redacted. Hosts must control what crosses a broker boundary and must not log them
as credential diagnostics. Transport/storage exceptions exclude raw causes.

Only an explicit OAuth rejection triggers one renewal and at most one replay:
401 by default, or a provider-declared 403. GET/HEAD can replay unless the caller
sets `retry: "never"`. Writes replay **only** when the target declares provider
idempotency support for that method and the caller supplies a stable
`idempotencyKey`. Buffered bytes and that key remain identical across attempts.
Unsafe writes return the first rejection without renewal or replay. Network errors,
timeouts, 429s, 5xx responses, and repeated rejections never trigger general retries.
An initial proactive renewal can occur before the first request; it is distinct
from the single rejection-driven renewal.

`transport.probe(binding)` runs only the selected method's declared fixed probe.
Results contain `accepted`, `rejected`, or `unverified`, plus HTTP status when
available—never response text. Only explicitly accepted 2xx statuses count as
accepted; 401/403 or an invalid grant count as rejected. Other responses, transport
failures, and absent probes are unverified. Accepted means the service accepted the
probe request, not that arbitrary scopes or an account identity were proven.

```ts
import * as t from "typebox";
import { CredentialRegistry, CredentialTransport } from "runline";

const credentials = new CredentialRegistry();
credentials.register({
  id: "example",
  methods: {
    apiKey: {
      schema: t.Object({ key: t.String({ minLength: 1 }) }, { additionalProperties: false }),
      authentication: { kind: "apiKey", field: "key", header: "X-Api-Key" },
      targets: { api: { baseUrl: "https://api.example.com/v1/", methods: ["GET"] } },
      probe: { target: "api", path: "me", method: "GET", acceptedStatuses: [200] },
    },
  },
});
const transport = new CredentialTransport(credentials, { fetch: hostEgressFetch });
// Binding comes from host authorization; never accept this object from an agent.
const response = await transport.request(authorizedBinding, {
  target: "api", path: "items?limit=10",
});
```

## Provider migration status

Microsoft Mail, Calendar, and Files use the shared registry and resource transport,
including binary uploads. Delegated and app-only modes are explicit; inference exists
only at the legacy flat-config adapter boundary. Probes target the selected service,
not an unrelated User.Read endpoint. Files downloads use Graph-provided signed URLs
on approved Microsoft domains, through bounded unauthenticated downloads; bearer
tokens are never forwarded to those URLs.

Google delegated and service-account token acquisition now use registry renewal.
The old Google signing and refresh implementations are removed. Flat legacy fields
are projected into revisioned grants through the same compatibility adapter as
Microsoft. Authority fingerprints invalidate cached tokens on application, method,
service-account identity/subject, or requested-scope changes. Malformed service-account
JSON fails closed; its `token_uri` never selects an endpoint.

All nine Google consumers (Gmail, Drive, Docs, Sheets, Slides, Calendar, Contacts,
Tasks, and Apps Script) now use shared resource transport. Service-specific target
profiles restrict destinations; builtin absolute URLs are translated at an explicit
adapter boundary before path normalization. Both delegated and service-account modes
use the same coordinated renewal and read-only rejection replay. Writes are not
replayed. Flat connection schemas expose optional `authMethod`.

Drive binary downloads, exports, revision restores, multipart uploads, and resumable
create/update chunks use bounded shared transport. Each buffered request/response is
limited to 64 MiB; larger filesystem uploads remain chunked. Resumable session URLs
must stay on the approved Drive upload endpoint. A declared upload target can accept
PUT `308 Resume Incomplete` only with Content-Range and **without** Location; no
redirect is followed. Upload completion requires a final 200/201. Slides thumbnails
use bounded unauthenticated downloads restricted to Googleusercontent hosts.

Fixed probes are available for Gmail, Drive, Calendar, Contacts, Tasks, and Apps
Script. Docs/Sheets/Slides return unverified rather than inventing document IDs or
requiring broader Drive scopes. `googleAccessToken` remains a trusted-runtime token
compatibility primitive, not a resource-request path or broker API.
Plaud is a native nine-action read-only plugin on the shared credential transport.
Its third-party OAuth definition uses Basic code exchange with PKCE/state, omits
`grant_type`, and refreshes at a separate endpoint with only `refresh_token`.
The current-user GET is its fixed probe. Transcript/summary content prefers inline
blocks; signed links require exact host-approved `contentOrigins` and use bounded
unauthenticated downloads. Unapproved links return an explicit approval-needed status.
No official CLI client credentials or token files are reused. Registration of a
third-party application and Runline's callback with Plaud remains a host prerequisite.
No provider migration has been verified against live accounts.

## Remaining implementation stages

These slices are not yet the complete credential architecture. Plugins still receive
raw configuration; providers other than Microsoft, Google, and Plaud retain
their existing resource-request helpers.
The registry/transport are opt-in host APIs; registering a definition does not make
an existing plugin safe. Other provider migrations, durable setup and the privileged
broker remain. In particular, existing generic
request actions with caller-selected destinations must not be exposed as privileged
broker operations merely because the transport now exists.

1. **Setup lifecycle:** PKCE/state, host-supplied application registration and
   callback URI, durable expiring flow storage, atomic consume-once completion,
   cancellation and reconnect fencing. Never execute arbitrary plugin setup code
   in a privileged host merely because it declares OAuth.
2. **Vex broker:** encrypted authoritative grants, user/workspace bindings, scoped
   IPC, and revision-aware invalidation. Token renewal must not restart workspace
   hosts. Authorization changes must take effect according to explicit policy.
3. **Provider migrations:** additional providers still using legacy resource helpers;
   live verification of Plaud's nonstandard refresh and application registration.
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
