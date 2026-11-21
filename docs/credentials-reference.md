# Credentials Reference

This page lists the request helpers, call fields, failure helpers, error codes, and declaration values of runline's credential layer. See [Credentials](credentials.md) for how to declare a credential and which declaration fits an API.

## Request helpers

| Helper | Returns | Throws |
|---|---|---|
| `credentialJson<T>(ctx, declaration, plugin, call)` | the answer's JSON; `{ success: true }` for an empty or 204 answer | on a non-2xx: `<plugin>: request failed (HTTP <status>)`, with `status` on the error |
| `credentialOk(ctx, declaration, plugin, call)` | the `Response`, for headers, text or bytes | the same |
| `credentialRequest(ctx, declaration, call)` | the `Response`, whatever its status | only `AuthError`: refused before sending, or no answer |
| `brokerFor(ctx, declaration)` | the broker itself: `request`, `probe`, `socketUrl` | |

Use `credentialRequest` when a non-2xx is an answer you handle (a 404 that means "absent"), and report a failure with [`responseFailed`](#failure-helpers). `jsonAnswer(response)` then reads the body as `credentialJson` does (an empty or 204 answer is `{ success: true }`, unreadable JSON is `invalid_response`); `jsonOrAcknowledged(response)` does the same only when the `Content-Type` says JSON, for writes that answer `OK` or nothing.

## Call fields

A call names a declared target and describes the request:

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

`Accept: application/json` is sent unless you set it. A body is buffered; for `FormData`, `multipartBody(form)` gives the bytes and the boundary `Content-Type`.

## Path helpers

Caller input goes into a path only through these, which refuse rather than encode anything that would change which resource is addressed:

| Helper | For | Refuses |
|---|---|---|
| `pathSegment(value)` | one ID or name as one segment | empty, `.`, `..`, `/`, `\` |
| `pathSegments(value)` | a slashed name the API addresses as a sub-path (`owner/name`, a file path) | any segment `pathSegment` refuses |
| `slashEncodedSegment(value)` | a slashed name as one encoded segment (`@scope/pkg` → `%40scope%2Fpkg`), for a target with `encodedSlashes: true` | the same |
| `pathWithin(ctx, declaration, target, url)` | a next-page URL the API returned, back into a path beneath the target | any URL outside the target's origin and base path |

## Renewal and resending

A rejected credential (`401`, or the method's `rejectionStatus`; a cookie session's declared rejection) is renewed at once, so the next call signs with the renewal. The rejected request is sent again, once, only when that is safe: a `GET` or `HEAD`, or a write with an `idempotencyKey` on a target that declares `idempotency`. Any other write returns its rejection, so it is never applied twice. Parallel calls that find an expired credential renew it once.

## Other request shapes

Some requests need more than one signed call to a declared target:

- **Uploads to a signed URL** a provider returns (an upload session, a presigned download): `presignedRequest(url, { allowedOrigins, fetch, method, headers, body })`, or `downloadResource` for a GET. No credential or cookie is sent with it, the origin must be one you list, and errors never include the URL. Report its failure without `status` (a plain `Error`): a refused presigned URL is the link expiring, not the connection's credential, and a host that reads `status` would mark a working login broken.
- **Resumable uploads** (Google's `308` with `Content-Range`): the target declares `resumableUpload: true`, allows `PUT` and allows `Content-Range`.
- **WebDAV**: a target may allow `MKCOL`, `COPY` and `MOVE`; `COPY` and `MOVE` take `destination`, a path beneath the same target.
- **WebSockets**: a target with `socket: true` and a `wss://` base; `credentialSocketUrl(ctx, declaration, { target, path, query })` returns a URL to open, signed by query placements only. A host may return a relay it controls, or refuse with `unsupported_operation`.
- **Slow or large answers**: the target declares `timeoutMs` or `maxResponseBytes`; a host caps both.
- **Files of any size**: a signed answer is held in memory and bounded by the signer, so a file is downloaded as byte ranges, 8 MiB a request, each signed, renewed and retried on its own. The target allows `Range`:

  ```typescript
  const { size, headers } = await rangedDownload(
    {
      plugin: "files",
      request: (range) =>
        credentialRequest(ctx, credential, {
          target: "api",
          path: `files/${pathSegment(id)}/content`,
          headers: { Range: range },
        }),
      failed: (response) => requestFailed("files", response.status),
    },
    { savePath },      // or { maxBytes, oversize } to get `bytes` in memory
    { md5 },           // the provider's checksum of the content, when it states one
  );
  ```

  The file appears at `savePath` only when complete. Content that changes between ranges is refused, as is content that does not match `md5`. A server that ignores `Range` and answers the whole content is taken as it is, up to the response ceiling. `request` may equally fetch a provider-issued URL through `presignedRequest`, with `failed` returning a plain `Error`.

## Failure helpers

These helpers build an error from a status and identifiers, never from the provider's text:

| Helper | For | Message |
|---|---|---|
| `responseFailed(plugin, response, read)` | a failed response whose JSON names a code or a field; `read` picks them from the provider's envelope | `<plugin>: request failed (HTTP 422 invalid_email, param: email)`, with `status` on the error |
| `requestFailed(plugin, status)` | a failed response, by status alone | `<plugin>: request failed (HTTP 404)`, with `status` on the error |
| `answerFailed(plugin, { code, param, message })` | a 2xx answer that reports failure (Slack's `ok: false`) | the code, the field, and one line of the message (data the plugin already holds) |
| `graphqlFailed(plugin, errors)` | a GraphQL `errors` array | the first error, by `answerFailed` |
| `awsFailed(plugin, response)` | a failed AWS response | the status and the AWS error code |

Keep the status in the message and on the error, as `responseFailed`, `requestFailed` and `awsFailed` do: a host reads it to tell a refused login (`401`) from any other failure, and marks the connection broken.

## Error codes

Anything the credential layer refuses is an `AuthError`, with a fixed message and a `code` (and the provider's `status` where it has one):

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

`refuseUnderHost(ctx)` throws `unsupported_operation` when a host keeps the credential: use it in an action that writes a login into the connection itself (a setup step), which only makes sense when signing locally.

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

Signing locally, an issued token, session or jar is stored stamped with the selection it was issued under; a connection whose client, scopes, role or login changes never reuses it.

## Authentication kinds

Each method's `authentication.field` names the one config field the secret is stored in.

| `kind` | Stored shape | Sent as |
|---|---|---|
| `none` | nothing | unsigned, still held to the method's targets |
| `static` | its named `parts`, each a string (`staticSecretSchema(parts, optionalParts)`) | each part through its `placements` |
| `oauth2` | a revisioned grant (`grantSchema` stores it in `grant`) | `Authorization: Bearer <access token>`, renewed by its `renewal` |
| `awsSigV4` | an access key (`AwsAccessKeySchema`); with `assumeRole: { sessionField }`, a session (`AwsSessionSchema`) in that field | AWS Signature Version 4 for each target's `aws: { service, region }` |
| `cookie` | a revisioned jar (`cookieSessionSchema` stores it in `session`) | the jar's matching cookies, after a login with the `resourceOwner` |

## Placements

A placement states where one part of a static secret goes:

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

## Targets

A target is one place a credential may be sent:

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

## Token endpoints

An `OAuth2Definition` has one endpoint per operation: `exchange`, `refresh`, `clientCredentials`, `jwtBearer`, `password`, and `authorization: { url, parameters }` for consent. Each endpoint is an HTTPS `url` and `clientAuthentication`, plus:

| Field | Meaning |
|---|---|
| `encoding` | `"form"` (default) or `"json"` |
| `grantType` | the `grant_type` to send in place of the standard one; `null` sends none |
| `parameters` | fixed provider fields; never one the protocol owns (`client_id`, `scope`, `refresh_token`, …) |
| `headers` | fixed provider headers; never `Authorization`, `Accept` or `Content-Type` |
| `refreshTokenBearer` | also send the refresh token as the request's bearer, as some mobile APIs require |
| `response` | where the token is, for a provider that does not answer in RFC 6749's shape: `path` into an envelope, and the names of `accessToken`, `refreshToken`, `expiresIn`, `tokenType`, `scope`, plus `metadata` fields to keep |
| `exchange.requirePkce`, `exchange.sendState` | the provider requires PKCE, or the state again at the code exchange |
