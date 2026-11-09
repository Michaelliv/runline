# Credentials: declaring and using them in a plugin

A plugin that calls an authenticated API never builds an `Authorization`
header, reads a token, or refreshes one. It **declares** its credential, and
sends every request through runline's request helpers, which sign it. This
guide is for anyone writing a plugin, bundled or custom; [For hosts](#for-hosts)
covers embedding runline with credentials kept elsewhere.

- [The model](#the-model)
- [Quick start: an API key](#quick-start-an-api-key)
- [Which declaration](#which-declaration)
- [Recipes](#recipes): [a key or token](#a-key-or-token) · [several parts, or an unusual placement](#several-parts-or-an-unusual-placement) · [an optional key](#an-optional-key) · [a host from config](#a-host-from-config) · [OAuth with a person's consent](#oauth-with-a-persons-consent) · [OAuth without a person](#oauth-without-a-person) · [AWS](#aws) · [a web app's cookie session](#a-web-apps-cookie-session)
- [Making requests](#making-requests)
- [Reporting failures](#reporting-failures)
- [Where the secret lives](#where-the-secret-lives)
- [Trying it](#trying-it)
- [For hosts](#for-hosts)
- [Reference](#reference)

## The model

Three pieces, and the plugin writes only the first two:

```
  declaration (pure)                request helper                  signer
  ──────────────────                ──────────────                  ──────
  config ──► what the secret is     credentialJson(ctx,             the host's broker, when it gives one
             how it is placed  ───► declaration, plugin, call) ───► (ctx.credentials), else
             where it may go                                         a local signer built from the
             (exact HTTPS targets)                                   connection's own config
```

- **A declaration** is a function from the connection's config to a
  *selection*: the credential type (its methods, each with an authentication
  kind and targets), which method this connection uses, and any OAuth
  application, resource owner or AWS role. It is pure: no IO, and never
  anything from action input. `staticCredential` and `awsCredential` build
  one for you; OAuth and cookie sessions are written out.
- **A request helper** (`credentialJson`, `credentialOk`, `credentialRequest`)
  takes a *target name* and a *path beneath it*, never a URL. Anything outside
  the declared targets, methods and headers is refused before a byte is sent.
- **The signer** puts the secret in, renews it when it expires or is
  rejected, and stores the renewal. Under a host that keeps credentials (a
  server signing for a sandboxed worker), the plugin's process never holds the
  secret at all; the same plugin code runs unchanged either way.

Why it is built this way: the secret can reach only the hosts the plugin
declared, a provider's error text (where a secret may be echoed) never reaches
an error message, and a host can sign for code it does not trust with its
tokens.

## Quick start: an API key

The README's [orders plugin](../README.md#writing-a-plugin) is a whole plugin
built around one credential. The credential parts of it:

```typescript
import { credentialJson, pathSegment, staticCredential } from "runline";

// A bearer token from the connection's `apiKey`, sent only beneath this base.
const credential = staticCredential({
  id: "orders",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: { baseUrl: "https://api.orders.example/v1/", methods: ["GET", "POST"] },
  },
  probe: { target: "api", path: "me", method: "GET", acceptedStatuses: [200] },
});

// When the plugin registers:
rl.setCredential(credential);
rl.setConnectionSchema(t.Object({ apiKey: t.String({ env: "ORDERS_API_KEY" }) }));

// In an action:
return credentialJson(ctx, credential, "orders", {
  target: "api",
  path: `orgs/${pathSegment(orgId)}/orders`,
  query: { limit },
});
```

Four things make it work:

1. `setCredential(credential)` tells runline (and a host) how this plugin
   signs. Without it, the request helpers still sign locally, but a host
   cannot broker for the plugin.
2. `local: { secret: "apiKey" }` names the flat config field the secret comes
   from when this process signs it itself, as the CLI does. The connection
   schema declares that field, with the environment variable that fills it.
3. The target `api` is the only place the token may go: an HTTPS base ending
   in `/`, and the methods allowed there.
4. Caller input goes into the path through `pathSegment`, which refuses `..`,
   empty values and separators instead of encoding them.

## Which declaration

| You have | Use | Recipe |
|---|---|---|
| One token or key, in `Authorization: Bearer`, a named header, a query parameter, or Basic auth | `staticCredential` with `bearer`, `apiKey`, `queryKey` or `basic` | [A key or token](#a-key-or-token) |
| Several values (a key and a secret, a token per API), or a secret in the path, the body, a signed JWT, an HMAC of the query | `staticCredential` with `kind: "static"` | [Several parts](#several-parts-or-an-unusual-placement) |
| A key that is optional: the API answers without one, with lower limits | `staticCredential({ …, optional: true })` | [An optional key](#an-optional-key) |
| A host the user configures (self-hosted, a subdomain, a region) | `targets` as a function of config, with `httpsBase`, `hostLabel`, `configChoice` | [A host from config](#a-host-from-config) |
| OAuth where a person consents in a browser, then a refresh token | an `oauth2` declaration, `renewal: "refresh"`, plus `setOAuth` | [OAuth with consent](#oauth-with-a-persons-consent) |
| OAuth with no person: client credentials, a username and password, a service account's JWT | an `oauth2` declaration, `renewal: "clientCredentials"`, `"password"` or `"jwtBearer"` | [OAuth without a person](#oauth-without-a-person) |
| AWS: an access key, a role it assumes, or an AWS CLI profile | `awsCredential` and `awsTarget` | [AWS](#aws) |
| A web app with no API, whose session is a login cookie | a `cookie` declaration | [A cookie session](#a-web-apps-cookie-session) |
| No secret at all | nothing: call the API with `fetch` | |

## Recipes

Every declaration here passes runline's own validation, the same a host runs,
which rejects a malformed one with `invalid_definition`, and signs a request
beneath its target: `packages/runline/src/tests/credentials-docs.test.ts` runs
each recipe's block as written. [Trying it](#trying-it) shows how to check
yours.

### A key or token

<!-- check: {"apiKey": "k-1", "apiToken": "t-1", "domain": "acme"} -->
```typescript
// Authorization: Bearer <secret>
staticCredential({
  id: "orders",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: { api: { baseUrl: "https://api.orders.example/v1/", methods: ["GET"] } },
});

// <header>: <prefix><secret>   (Okta's "Authorization: SSWS <token>")
staticCredential({
  id: "okta",
  auth: { kind: "apiKey", header: "Authorization", prefix: "SSWS " },
  local: { secret: "apiToken" },
  targets: { api: { baseUrl: "https://acme.okta.com/api/v1/", methods: ["GET"] } },
});

// ?appid=<secret>
staticCredential({
  id: "weather",
  auth: { kind: "queryKey", param: "appid" },
  local: { secret: "apiKey" },
  targets: { api: { baseUrl: "https://api.weather.example/data/2.5/", methods: ["GET"] } },
});

// Authorization: Basic base64(username:password); here the key is the
// username and the password is the fixed "X" Freshdesk documents.
staticCredential({
  id: "freshdesk",
  auth: { kind: "basic" },
  local: { username: "apiKey", password: { value: "X" } },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.domain)}.freshdesk.com/api/v2/`,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
```

`local` has exactly one entry per part: `secret` for the single-secret kinds,
`username` and `password` for `basic`. Each entry is a config field name, a
fixed `{ value }`, or `{ concat: [...] }` of both in order. A key that is not a
part, or a missing part, throws `invalid_definition` when the module loads.

### Several parts, or an unusual placement

The general form names its `parts` and where each is placed:

<!-- check: {"email": "me@acme.example", "apiToken": "z-1", "subdomain": "acme", "botToken": "123:abc", "trackingKey": "t-1", "appKey": "a-1"} -->
```typescript
// Zendesk: Basic "<email>/token:<api token>"; one part is two things joined.
staticCredential({
  id: "zendesk",
  auth: {
    kind: "static",
    parts: ["username", "password"],
    placements: [{ in: "basic", username: "username", password: "password" }],
  },
  local: {
    username: { concat: [{ field: "email" }, { value: "/token" }] },
    password: "apiToken",
  },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.subdomain)}.zendesk.com/api/v2/`,
      methods: ["GET"],
    },
  }),
});

// Telegram: the token is the first path segment, as bot<token>.
staticCredential({
  id: "telegram",
  auth: {
    kind: "static",
    parts: ["token"],
    placements: [{ in: "path", part: "token", prefix: "bot" }],
  },
  local: { token: "botToken" },
  targets: { api: { baseUrl: "https://api.telegram.org/", methods: ["GET", "POST"] } },
});

// Two APIs, a key each; the second is optional and refuses only its own target.
staticCredential({
  id: "customerIo",
  auth: {
    kind: "static",
    parts: ["trackKey", "appKey"],
    optionalParts: ["appKey"],
    placements: [
      { in: "basic", username: "trackKey", password: "trackKey", targets: ["track"] },
      { in: "header", part: "appKey", name: "Authorization", prefix: "Bearer ", targets: ["app"] },
    ],
  },
  local: { trackKey: "trackingKey", appKey: "appKey" },
  targets: {
    track: { baseUrl: "https://track.customer.io/api/v1/", methods: ["POST", "PUT"] },
    app: { baseUrl: "https://api.customer.io/v1/", methods: ["GET"] },
  },
});
```

Every placement is in the [placement table](#placements): `header`, `query`,
`body` (a top-level JSON or form field), `jsonPointer` (a slot deep in a JSON
body the request leaves `null`), `path`, `basic`, `jwt` (an HS256 JWT minted
per request, Ghost's Admin API) and `querySignature` (an HMAC of the query as
sent). Whatever a placement sets is reserved: a caller that tries to set that
header, parameter or field is refused. Each target must be signed by at least
one placement.

### An optional key

<!-- check: {} -->
```typescript
staticCredential({
  id: "coingecko",
  auth: { kind: "apiKey", header: "x-cg-demo-api-key" },
  local: { secret: "apiKey" },
  optional: true,
  targets: { api: { baseUrl: "https://api.coingecko.com/api/v3/", methods: ["GET"] } },
});
```

`optional: true` adds a `none` method that sends requests unsigned, held to
the same targets. A connection signs when it holds the `local` fields (the
CLI), or when its public config says `authenticated: true` (a host that stores
the key). Use `optional: { targets: { … } }` when the provider serves unsigned
requests from different hosts.

### A host from config

When a connection names its host, `targets` is a function of config, and the
config values pass through a helper that refuses anything that could send the
secret elsewhere:

<!-- check: {"url": "https://grafana.acme.example", "apiKey": "g-1"} -->
```typescript
staticCredential({
  id: "grafana",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: { baseUrl: httpsBase(config.url, "api/"), methods: ["GET", "POST"] },
  }),
});
```

| Helper | Accepts | Refuses with `invalid_credentials` |
|---|---|---|
| `httpsBase(value, path)` | an HTTPS URL; returns it with a trailing `/` and `path` appended | plain HTTP, embedded user or password, a query or fragment |
| `hostLabel(value)` | one DNS label, for `https://{label}.provider.com/` | dots, slashes, anything that is not a label |
| `configChoice(value, choices, fallback)` | one of `choices`, or `fallback` when absent | any other value: a mistyped region never falls back to the default host |
| `configFlag(value)` | `true`, `false`, `"true"`, `"false"`; false when absent | anything else |

### OAuth with a person's consent

The person consents once in a browser; the connection then holds a refresh
token, and the signer renews the access token whenever it is about to expire
or the API rejects it. Two declarations work together: `setOAuth` drives
`runline auth <plugin>`, which runs the consent and stores the tokens, and
`setCredential` says how requests are signed and renewed.

<!-- check: {"clientId": "c-1", "clientSecret": "s-1", "refreshToken": "r-1"} -->
```typescript
import {
  type CredentialDeclaration,
  configChoice,
  credentialJson,
  grantSchema,
  type RunlinePluginAPI,
} from "runline";
import * as t from "typebox";

const SCOPES = ["contacts.read", "contacts.write"];

const credential: CredentialDeclaration = (config) => {
  // The token endpoint and the API stay on the same region.
  const region = configChoice(config.region, ["us", "eu"], "us");
  const host = region === "eu" ? "https://eu.acme.example" : "https://acme.example";
  return {
    type: {
      id: "acme",
      methods: {
        oauth2: {
          schema: grantSchema,
          authentication: {
            kind: "oauth2",
            field: "grant",
            renewal: "refresh",
            definition: {
              id: "acme.oauth2",
              provider: "acme",
              refresh: {
                url: `${host}/oauth/token`,
                clientAuthentication: "client_secret_post",
              },
            },
          },
          targets: {
            api: { baseUrl: `${host}/api/v2/`, methods: ["GET", "POST", "PATCH", "DELETE"] },
          },
          probe: { target: "api", path: "me", method: "GET", acceptedStatuses: [200] },
        },
      },
    },
    method: "oauth2",
    application: {
      clientId: config.clientId as string,
      ...(typeof config.clientSecret === "string"
        ? { clientSecret: config.clientSecret }
        : {}),
    },
  };
};

export default function acme(rl: RunlinePluginAPI) {
  rl.setName("acme");
  rl.setVersion("1.0.0");
  rl.setCredential(credential);
  rl.setOAuth({
    authUrl: "https://acme.example/oauth/authorize",
    tokenUrl: "https://acme.example/oauth/token",
    scopes: SCOPES,
    setupHelp: [
      "Create an OAuth app at https://acme.example/developers.",
      "Register this redirect URI: {{redirectUri}}",
    ],
  });
  rl.setConnectionSchema(
    t.Object({
      clientId: t.String({ env: "ACME_CLIENT_ID" }),
      clientSecret: t.String({ env: "ACME_CLIENT_SECRET" }),
      region: t.Optional(t.Union([t.Literal("us"), t.Literal("eu")])),
    }),
  );
  rl.registerAction("contact.list", {
    access: "read",
    inputSchema: t.Object({}, { additionalProperties: false }),
    execute: (_input, ctx) =>
      credentialJson(ctx, credential, "acme", { target: "api", path: "contacts" }),
  });
}
```

```bash
export ACME_CLIENT_ID=… ACME_CLIENT_SECRET=…
runline auth acme        # opens the browser, stores the tokens in a connection
runline exec 'return await acme.contact.list({})'
```

- `schema: grantSchema` and `field: "grant"` are the stored shape every OAuth
  method uses: one revisioned grant. You never read it.
- `application` is the OAuth client, from config. A host replaces it with its
  own.
- `clientAuthentication` is how the token endpoint wants the client:
  `client_secret_post` (form fields), `client_secret_basic` (Basic auth),
  `client_id` (the id alone), `client_id_basic` (a public client: Basic with an
  empty secret), or `none`. See the [token endpoint fields](#token-endpoints)
  for JSON encodings, envelopes and provider-specific parameters.
- A provider whose rejection is a `403`, not a `401`, declares
  `rejectionStatus: 403`.
- `setOAuth` takes `publicClient: true` (PKCE, no secret), `redirectUri` for
  a provider that only accepts a loopback URI it published, and `grant` when
  several plugins share one consent (as every Google plugin does). For a
  provider whose token request needs more than a form post, give
  `setOAuth({ protocol: definition, scopes })` the same `OAuth2Definition`
  instead of `authUrl` and `tokenUrl`.
- A renewal that the provider refuses because the grant is dead
  (`invalid_grant`) is `reconnect_required`: run `runline auth` again. Any
  other refusal of the token request is `provider_rejected`, with the
  provider's status: usually the client itself (its secret, its redirect URI).

### OAuth without a person

The same `oauth2` declaration, with a renewal that needs no browser. The
signer gets a token on the first request and again whenever it expires or is
rejected.

<!-- check: {"clientId": "c-1", "clientSecret": "s-1"} -->
```typescript
// Client credentials: the client is the identity.
const credential: CredentialDeclaration = (config) => ({
  type: {
    id: "acmeMachine",
    methods: {
      oauth2: {
        schema: grantSchema,
        authentication: {
          kind: "oauth2",
          field: "grant",
          renewal: "clientCredentials",
          scopes: ["reports.read"],
          definition: {
            id: "acmeMachine.oauth2",
            provider: "acme",
            clientCredentials: {
              url: "https://acme.example/oauth/token",
              clientAuthentication: "client_secret_basic",
            },
          },
        },
        targets: { api: { baseUrl: "https://acme.example/api/v2/", methods: ["GET"] } },
      },
    },
  },
  method: "oauth2",
  application: {
    clientId: config.clientId as string,
    clientSecret: config.clientSecret as string,
  },
});
```

| `renewal` | Identity, from the selection | Endpoint in `definition` |
|---|---|---|
| `"clientCredentials"` | `application` | `clientCredentials` |
| `"password"` | `resourceOwner: { username, password }`, sent under the endpoint's `fields` names (`username` and `password` by default) | `password` |
| `"jwtBearer"` | `jwtIdentity: { issuer, privateKey, subject? }`: an RS256 assertion (2048-bit RSA or larger), valid an hour; `scopes` required, `clientAuthentication: "none"` | `jwtBearer` |
| `"refresh"` | the stored refresh token, and `application` | `refresh` |

Include `resourceOwner` or `jwtIdentity` only when the config holds it, so a
host that stores the secret elsewhere supplies its own:

```typescript
...(typeof config.username === "string" && typeof config.password === "string"
  ? { resourceOwner: { username: config.username, password: config.password } }
  : {}),
```

A credential type may hold several methods, each with its own renewal
(Google's plugins declare a `delegated` method that refreshes and a
`serviceAccount` method signed by JWT), and the declaration picks one from
config.

### AWS

<!-- check: {"accessKeyId": "AKIAEXAMPLE", "secretAccessKey": "s-1", "region": "eu-west-1"} -->
```typescript
import { awsCredential, awsJson, awsRegion, awsTarget } from "runline";

const credential = awsCredential({
  id: "aws",
  targets: (config) => ({
    ssm: awsTarget("ssm", awsRegion(config.region ?? "us-east-1")),
  }),
});
```

In an action:

```typescript
awsJson(ctx, credential, "fleet", {
  target: "ssm",
  operation: "AmazonSSM.DescribeInstanceInformation",
  version: "1.1",
});
```

The connection holds `accessKeyId`, `secretAccessKey` and, for a session's
key, `sessionToken`. Public config shapes the rest:

| Config | Effect |
|---|---|
| `roleArn` | The key only assumes this role through STS; requests sign with the role's sessions, renewed five minutes before they expire. `roleSessionName` (default `runline`), `roleExternalId`, `roleDurationSeconds` (900 to 43200) shape the session. |
| `stsRegion`, else `region`, else `us-east-1` | Where sessions are requested. |
| `awsProfile` | Sign with an AWS CLI profile's key instead of a stored one (an SSO login), through `aws configure export-credentials`. Local signing only; a host ignores it. A profile with no login is `reconnect_required`: run `aws sso login`. |

`awsTarget(service, region)` is the regional endpoint, signed for that service
and region; `X-Amz-Target` is always allowed. `awsJson` calls a JSON-protocol
service (SSM, CloudWatch Logs, Secrets Manager) by operation; `awsQuery` a
Query-protocol service (EC2, STS) by action, its XML answer read as data, with
`awsList` for its `item` or `member` lists. `awsFailed` reports a failure by
status and AWS error code. SigV4 owns `Authorization`, `X-Amz-Date`,
`X-Amz-Security-Token` and `X-Amz-Content-Sha256`, and refuses a presigned
URL's `X-Amz-*` query parameters. An STS refusal of the key itself
(`InvalidClientTokenId`, `SignatureDoesNotMatch`, `ExpiredToken`) is
`reconnect_required`; a refusal to assume the role is `provider_rejected`.

### A web app's cookie session

For an app with no API whose session is a login cookie. The transport logs
in with the owner's username and password, keeps the cookie jar, sends each
cookie only where it belongs, and logs in again when the app shows the session
was rejected. The plugin never sees the password, a cookie, or a `Set-Cookie`.

<!-- check: {"username": "me@acme.example", "password": "pw-1"} -->
```typescript
import { type CredentialDeclaration, cookieSessionSchema } from "runline";

const credential: CredentialDeclaration = (config) => ({
  type: {
    id: "acmeApp",
    methods: {
      cookie: {
        schema: cookieSessionSchema,
        authentication: {
          kind: "cookie",
          field: "session",
          login: {
            target: "app",
            path: "accounts/login/",       // beneath the target, like any request path
            encoding: "form",              // or "json"
            fields: { username: "email" }, // the app's names; username/password by default
            preflight: "accounts/login/",  // optional GET first, e.g. for a CSRF cookie
          },
          rejection: {                     // at least one signal
            statuses: [401, 403],          // 4xx only (Laravel's 419, IIS's 440 too)
            loginPaths: ["accounts/login/"], // a redirect to one of these
            // marker: 'id="login-form"',  // or this text in a 2xx HTML answer
          },
          csrf: { cookie: "csrftoken", header: "X-CSRFToken" }, // optional
        },
        targets: {
          app: { baseUrl: "https://app.acme.example/", methods: ["GET", "POST"] },
        },
      },
    },
  },
  method: "cookie",
  ...(typeof config.username === "string" && typeof config.password === "string"
    ? { resourceOwner: { username: config.username, password: config.password } }
    : {}),
});
```

- **The login target** must allow `POST`, and `GET` too when there is a
  preflight. `parameters` adds fixed fields (`remember: "1"`), never a secret.
- **The jar** follows RFC 6265: a rotated cookie replaces its namesake,
  `Max-Age=0` deletes, a `Domain` the host does not match is ignored. The login
  sends the jar it already has, so a device-trust cookie survives a re-login.
  A rotated cookie lands only on the login it came from, so a slow answer to an
  old session never undoes a newer login.
- **On rejection** there is one re-login, then one resend for a request that
  is safe to send twice (see [renewal and resending](#renewal-and-resending)).
  A rejection by redirect or marker reaches the plugin as a bare `401`.
- **Login failures**: a 4xx or 5xx answer to the login is `provider_rejected`
  with its status (often a wrong password); a login answered with a rejection
  signal, or that sets no cookie, is `reconnect_required`.
- **Not supported**: logins that need HTML scraping, more than one host
  (SSO), or a one-time code.

## Making requests

### The helpers

| Helper | Returns | Throws |
|---|---|---|
| `credentialJson<T>(ctx, declaration, plugin, call)` | the answer's JSON; `{ success: true }` for an empty or 204 answer | on a non-2xx: `<plugin>: request failed (HTTP <status>)`, with `status` on the error |
| `credentialOk(ctx, declaration, plugin, call)` | the `Response`, for headers, text or bytes | the same |
| `credentialRequest(ctx, declaration, call)` | the `Response`, whatever its status | only `AuthError`: refused before sending, or no answer |
| `brokerFor(ctx, declaration)` | the broker itself: `request`, `probe`, `socketUrl` | |

Use `credentialRequest` when a non-2xx is an answer you handle (a 404 that
means "absent"), and report a failure with [`responseFailed`](#reporting-failures).
`jsonAnswer(response)` then reads the body as `credentialJson` does (an empty
or 204 answer is `{ success: true }`, unreadable JSON is `invalid_response`);
`jsonOrAcknowledged(response)` does the same only when the `Content-Type` says
JSON, for writes that answer `OK` or nothing.

### The call

```typescript
{
  target: "api",               // a declared target's name
  path: "orgs/acme/orders",    // relative to its baseUrl: no leading "/", no scheme
  method: "POST",              // default GET; must be one the target allows
  query: { limit: 10, tag: ["a", "b"] }, // appended; arrays repeat the key, null/undefined skipped
  json: { … },                 // JSON body, with its Content-Type
  form: { … },                 // or a form body, encoded like query
  body: bytesOrString,         // or raw bytes; set Content-Type in headers
  headers: { "X-Request-Id": "…" }, // only Accept, Content-Type and the target's allowedHeaders
  idempotencyKey: "…",         // for a target that declares idempotency
  destination: "files/new",    // COPY and MOVE only
}
```

`Accept: application/json` is sent unless you set it. A body is buffered;
for `FormData`, `multipartBody(form)` gives the bytes and the boundary
`Content-Type`.

### Paths

Caller input goes into a path only through these, which refuse rather than
encode anything that would change which resource is addressed:

| Helper | For | Refuses |
|---|---|---|
| `pathSegment(value)` | one ID or name as one segment | empty, `.`, `..`, `/`, `\` |
| `pathSegments(value)` | a slashed name the API addresses as a sub-path (`owner/name`, a file path) | any segment `pathSegment` refuses |
| `slashEncodedSegment(value)` | a slashed name as one encoded segment (`@scope/pkg` → `%40scope%2Fpkg`), for a target with `encodedSlashes: true` | the same |
| `pathWithin(ctx, declaration, target, url)` | a next-page URL the API returned, back into a path beneath the target | any URL outside the target's origin and base path |

### Renewal and resending

A rejected credential (`401`, or the method's `rejectionStatus`; a cookie
session's declared rejection) is renewed at once, so the next call signs with
the renewal. The rejected request is sent again, once, only when that is safe:
a `GET` or `HEAD`, or a write with an `idempotencyKey` on a target that
declares `idempotency`. Any other write returns its rejection, so it is never
applied twice. Parallel calls that find an expired credential renew it once.

### Other request shapes

- **Uploads to a signed URL** a provider returns (an upload session, a
  presigned download): `presignedRequest(url, { allowedOrigins, fetch, method,
  headers, body })`, or `downloadResource` for a GET. No credential or cookie
  is sent with it, the origin must be one you list, and errors never include
  the URL. Report its failure without `status` (a plain `Error`): a refused
  presigned URL is the link expiring, not the connection's credential, and a
  host that reads `status` would mark a working login broken.
- **Resumable uploads** (Google's `308` with `Content-Range`): the target
  declares `resumableUpload: true`, allows `PUT` and allows `Content-Range`.
- **WebDAV**: a target may allow `MKCOL`, `COPY` and `MOVE`; `COPY` and `MOVE`
  take `destination`, a path beneath the same target.
- **WebSockets**: a target with `socket: true` and a `wss://` base;
  `credentialSocketUrl(ctx, declaration, { target, path, query })` returns a
  URL to open, signed by query placements only. A host may return a relay it
  controls, or refuse with `unsupported_operation`.
- **Slow or large answers**: the target declares `timeoutMs` or
  `maxResponseBytes`; a host caps both.

## Reporting failures

A provider's error text can echo what it was sent, the credential included,
so failures are reported by status and identifiers only:

| Helper | For | Message |
|---|---|---|
| `responseFailed(plugin, response, read)` | a failed response whose JSON names a code or a field; `read` picks them from the provider's envelope | `<plugin>: request failed (HTTP 422 invalid_email, param: email)`, with `status` on the error |
| `requestFailed(plugin, status)` | a failed response, by status alone | `<plugin>: request failed (HTTP 404)`, with `status` on the error |
| `answerFailed(plugin, { code, param, message })` | a 2xx answer that reports failure (Slack's `ok: false`) | the code, the field, and one line of the message (data the plugin already holds) |
| `graphqlFailed(plugin, errors)` | a GraphQL `errors` array | the first error, by `answerFailed` |
| `awsFailed(plugin, response)` | a failed AWS response | the status and the AWS error code |

```typescript
const response = await credentialRequest(ctx, credential, { target: "api", path });
if (response.status === 404) return null;
if (!response.ok)
  throw await responseFailed("orders", response, (body) => {
    const error = (body as { error?: { code?: unknown; field?: unknown } }).error;
    return { code: error?.code, param: error?.field };
  });
return jsonAnswer(response);
```

Keep the status in the message and on the error, as `responseFailed`,
`requestFailed` and `awsFailed` do: a host reads it to tell a refused login
(`401`) from any other failure, and marks the connection broken.

Anything the credential layer refuses is an `AuthError`, with a fixed message
and a `code` (and the provider's `status` where it has one):

| `code` | Means | Who fixes it |
|---|---|---|
| `invalid_definition` | The declaration is malformed: an unknown kind, a target that is not HTTPS, a reserved header allowed, a part never placed | the plugin author |
| `invalid_credentials` | The connection lacks the secret, or its config cannot be signed with (a bad region, a host that is not HTTPS) | whoever configures the connection |
| `request_not_allowed` | The request is outside the declaration: an undeclared target or method, a header not allowed, an unsafe path, a reserved parameter | the plugin author |
| `reconnect_required` | The login is dead: `invalid_grant`, an STS refusal of the key, a cookie login rejected | the person who connected it: reconnect |
| `provider_rejected` | A token request or login refused for another reason, with its status | usually the OAuth client or the password |
| `request_failed` | A token request got no answer | nobody: try again |
| `transport_failed` | No answer, a timeout, or a redirect; a write's outcome is unknown | check before retrying a write |
| `invalid_response` | The provider answered something unreadable | |
| `response_too_large` | The answer exceeded the limit | raise the target's `maxResponseBytes` |
| `credential_store_failed` | The renewal could not be stored; the provider may already have rotated the token | the host |
| `binding_changed` | The connection was replaced while the call ran | try again |
| `unsupported_operation` | The signer cannot do this here (a socket without a relay, a setup step under a host) | |

`refuseUnderHost(ctx)` throws `unsupported_operation` when a host keeps the
credential: use it in an action that writes a login into the connection
itself (a setup step), which only makes sense when signing locally.

## Where the secret lives

The same plugin signs in two places, and the declaration serves both:

| | Signing locally (the CLI, the SDK without a broker) | Under a host (`ctx.credentials`) |
|---|---|---|
| Who holds the secret | this process, in the connection's flat config | the host, outside this process |
| Static secret | the `local` fields (`apiKey`, …) | the host's structured `credential` field |
| OAuth | `clientId`, `clientSecret`, `refreshToken`, `accessToken`, `accessTokenExpiresAt`, as `runline auth` stores them; renewals are written back flat | the host's grant |
| AWS | `accessKeyId`, `secretAccessKey`, `sessionToken`, or `awsProfile`; an assumed role's session in `awsSession` | the host's key and session |
| Cookie session | the jar in `cookieSession` | the host's jar |
| The plugin's config | everything | public settings only (a region, a host, `authenticated: true`) |

Signing locally, an issued token, session or jar is stored stamped with the
selection it was issued under; a connection whose client, scopes, role or
login changes never reuses it.

## Trying it

```bash
runline connection add orders --plugin orders --set apiKey=$ORDERS_API_KEY
runline exec 'return await orders.list({ orgId: "acme", limit: 1 })'
runline actions --json   # loaded actions and schemas; loader errors on stderr
```

A declaration error shows up on the first request, as `invalid_definition`.
To check one without a request, register its type:

```typescript
import { CredentialRegistry } from "runline";
new CredentialRegistry().register(credential({ apiKey: "x" }).type); // throws invalid_definition
```

A `probe` is a cheap read a host may run to check that a connection works:
`accepted` for one of its `acceptedStatuses`, `rejected` for a 401 or 403 (or
a dead login), `unverified` otherwise. Declare one where the API has an
endpoint every working credential may read (`me`, `account`, a one-item list).

## For hosts

A host that keeps credentials outside the process running actions passes
`credentialBroker` to `Runline.create`. The engine calls it once per action
call of a plugin that declares its credential, with `{ plugin, action,
context }` (`context` is what that `execute()` was given), and hands the
result to the action as `ctx.credentials`. The plugin then sends every request
and probe through it and signs nothing itself.

```typescript
const rl = Runline.create({
  plugins: [gmail],
  credentialBroker: ({ plugin, action, context }) => ({
    request: (req) => signOnServer({ plugin, action, context, req }),
    probe: () => probeOnServer({ plugin, context }),
  }),
});
```

- **Authorize, then sign.** The broker is the authority: plugin code chooses
  the request, so decide from `context` and `action` before signing.
- **Sign with what you loaded.** Take the selection from
  `plugin.credential(config)` on the plugin definition the host loaded itself:
  its types, targets, token endpoints, scopes, application and roles. Never
  take any of it from the plugin's process.
- **Do the signing with the same primitives.** `CredentialRegistry` validates
  and holds types; `CredentialTransport` signs, renews and stores against a
  `CredentialBinding` (type, method, a `ConnectionHandle`, identity,
  application, resource owner, JWT identity, AWS role). Its options are the
  egress `fetch` (enforce DNS and IP policy there), `timeoutMs` (default 20 s),
  `maxRequestBytes` (1 MiB), `maxResponseBytes` (8 MiB), and the ceilings a
  target may raise them to: `maxTargetTimeoutMs` (10 min) and
  `maxTargetResponseBytes` (256 MiB).
- **Hear about failed calls.** A `ConnectionProvider`'s handle may implement
  `failed(error)`: called at most once per action call that acted through it
  and threw, after every `update` the call awaited, never awaited by the call.
  Judge there whether the failure is the connection's own (its status or
  `AuthError` code), and mark it.
- **Run the consent.** `buildAuthUrl`, `generatePKCE` and `exchangeAuthCode`
  drive the authorization-code flow for a plugin's `setOAuth` config where
  `runOAuth`'s local callback server cannot run; `buildOAuth2AuthorizationUrl`,
  `exchangeOAuth2Code`, `refreshOAuth2Token`, `acquireOAuth2ClientToken`,
  `acquireOAuth2PasswordToken` and `acquireOAuth2JwtToken` are the protocol
  primitives under them.

## Reference

### Authentication kinds

Each method's `authentication.field` names the one config field the secret is
stored in.

| `kind` | Stored shape | Sent as |
|---|---|---|
| `none` | nothing | unsigned, still held to the method's targets |
| `static` | its named `parts`, each a string (`staticSecretSchema(parts, optionalParts)`) | each part through its `placements` |
| `oauth2` | a revisioned grant (`grantSchema` stores it in `grant`) | `Authorization: Bearer <access token>`, renewed by its `renewal` |
| `awsSigV4` | an access key (`AwsAccessKeySchema`); with `assumeRole: { sessionField }`, a session (`AwsSessionSchema`) in that field | AWS Signature Version 4 for each target's `aws: { service, region }` |
| `cookie` | a revisioned jar (`cookieSessionSchema` stores it in `session`) | the jar's matching cookies, after a login with the `resourceOwner` |

### Placements

| Placement | Sent as |
|---|---|
| `{ in: "header", part, name, prefix? }` | `<name>: <prefix><part>` |
| `{ in: "query", part, name }` | `?<name>=<part>` |
| `{ in: "body", part, name }` | a top-level field of a JSON-object or form body; in the query when the request has no body |
| `{ in: "jsonPointer", part, pointer }` | the value at an RFC 6901 pointer in a JSON body (`/params/args/2`), where the request carries `null` |
| `{ in: "path", part, prefix? }` | the first path segment beneath the base, `<prefix><part>`; at most one per target. A secret in a URL can reach access logs, so a host may refuse it |
| `{ in: "basic", username, password }` | `Authorization: Basic base64(username:password)`; either part may be empty, not both |
| `{ in: "jwt", part, name, prefix?, audience }` | `<name>: <prefix><JWT>`, an HS256 JWT minted per request from a `<key id>:<hex secret>` part, valid five minutes |
| `{ in: "querySignature", part, name }` | `<name>: base64(HMAC-SHA256(query))`, over the query as sent, after every other placement |

Any placement may add `targets: [...]`, the targets it alone signs.

### Targets

| Field | Meaning |
|---|---|
| `baseUrl` | `https://…/` ending in `/` (`wss://` for a socket), exactly as written: no query, fragment, credentials, or anything URL parsing would rewrite |
| `methods` | the HTTP methods allowed: `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `MKCOL`, `COPY`, `MOVE` |
| `allowedHeaders` | headers a caller may set beyond `Accept` and `Content-Type`; never one the credential sets, `Authorization`, `Destination`, `Cookie`, `Host` or other hop-by-hop headers |
| `idempotency` | `{ header, methods }`: the provider deduplicates writes by this header, so they may be resent after a renewal |
| `encodedSlashes` | the API addresses one resource by an encoded slashed name (`group%2Fproject`) |
| `resumableUpload` | Google-style `PUT` uploads answered `308`; needs `PUT` and `Content-Range` allowed |
| `timeoutMs`, `maxResponseBytes` | this target's deadline and response ceiling, within the host's caps |
| `socket` | a `wss://` endpoint, signed by query placements only |
| `aws` | `{ service, region }`: required on every target of an `awsSigV4` method, refused on any other |

### Token endpoints

An `OAuth2Definition` has one endpoint per operation: `exchange`, `refresh`,
`clientCredentials`, `jwtBearer`, `password`, and `authorization: { url,
parameters }` for consent. Each endpoint is an HTTPS `url` and
`clientAuthentication`, plus:

| Field | Meaning |
|---|---|
| `encoding` | `"form"` (default) or `"json"` |
| `grantType` | the `grant_type` to send in place of the standard one; `null` sends none |
| `parameters` | fixed provider fields; never one the protocol owns (`client_id`, `scope`, `refresh_token`, …) |
| `headers` | fixed provider headers; never `Authorization`, `Accept` or `Content-Type` |
| `refreshTokenBearer` | also send the refresh token as the request's bearer, as some mobile APIs require |
| `response` | where the token is, for a provider that does not answer in RFC 6749's shape: `path` into an envelope, and the names of `accessToken`, `refreshToken`, `expiresIn`, `tokenType`, `scope`, plus `metadata` fields to keep |
| `exchange.requirePkce`, `exchange.sendState` | the provider requires PKCE, or the state again at the code exchange |
