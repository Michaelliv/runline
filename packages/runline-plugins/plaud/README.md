# Plaud

Native, read-only Runline actions for recordings in a personal Plaud account. No MCP server, Plaud CLI process, borrowed client credentials, or reads from `~/.plaud/tokens.json`.

Uses Plaud's **third-party API** at `https://platform.plaud.ai/developer/api/open/third-party/`. This is not the Plaud Embedded partner API or unofficial `api.plaud.ai` device/product API.

## Authentication

For browser login, obtain your own third-party OAuth client ID/secret and have Plaud register Runline's exact callback (`http://127.0.0.1:47823/callback` by default). The official CLI uses a different callback; its registration does not imply Runline's is allowed. See [Plaud contact](https://docs.plaud.ai/plaud-mcp-cli/contact) for registration questions.

```sh
# PLAUD_CLIENT_ID and PLAUD_CLIENT_SECRET may be supplied by your secret manager.
runline auth plaud
```

Alternatively, the host can seed a connection with `refreshToken`, or a cached `accessToken` and optional `accessTokenExpiresAt` (epoch milliseconds). Environment hints for explicit CLI/file connections are `PLAUD_REFRESH_TOKEN` and `PLAUD_ACCESS_TOKEN`. The in-memory SDK never reads them implicitly. Refresh needs only the refresh token, not application credentials. A cached access token without a refresh token cannot renew after expiry/rejection.

The shared protocol declares PKCE, host-validated state at exchange, Basic authentication for code exchange, no `grant_type`, and a separate refresh endpoint with only `refresh_token`. Host connection updates coordinate renewal and commit before resource use; one rejected GET can renew/replay. No network, rate-limit, server-error, or failed-refresh retries.

**Verification:** mocked tests and the published `@plaud-ai/cli@0.3.13` protocol were used. Third-party application registration, live login, and live refresh rotation have not been verified. This implementation does not imply self-service client registration is available.

## Actions

| Action | Input | Behavior |
| --- | --- | --- |
| `user.get` | `{}` | Current user; also the credential definition's fixed safe probe |
| `recording.list` | `page?`, `pageSize?` | One raw list page; page 1–1000, size 10–100 (default 20) |
| `recording.get` | `id` | Full recording metadata, source blocks, notes, and signed URLs |
| `recording.search` | `query`, `from?`, `to?`, `limit?`, `maxPages?` | Case-insensitive **name** substring; inclusive UTC dates (`YYYY-MM-DD`), not full-text search |
| `recording.recent` | `days?`, `limit?`, `maxPages?` | Created within the last N days (default 7), in provider order |
| `recording.audioUrl` | `id` | Signed URL or `null`; no download or expiry guess |
| `transcript.get` | `id`, `block?` | `transaction` (default), `transaction_polish`, `outline`, or `mark_memo` |
| `summary.get` | `id`, `index?` | One `auto_sum_note`, selected by zero-based summary index |
| `note.list` | `id` | Every note block verbatim, without downloading links |

Search/recent scan up to five pages of 100 by default; `maxPages` is capped at 10 and `limit` at 1000 (default 50). Results include `recordings`, `scanned`, `pagesScanned`, and `truncated`. `truncated: true` means more matches may exist. Scans do not stop on old timestamps or claim a globally sorted/exhaustive result. Moving offset pages can still miss records. Durations and transcript segment times remain in provider units (milliseconds).

```js
const page = await plaud.recording.list({ pageSize: 20 });
const matches = await plaud.recording.search({ query: "roadmap", maxPages: 5 });
const transcript = await plaud.transcript.get({ id: page.data[0].id });
return { matches, transcript };
```

## Signed transcript/summary links

Inline `data_content` is preferred. Linked `data_link` content requires an exact HTTPS origin approved in the **host-managed connection**:

```json
{
  "contentOrigins": ["https://your-approved-plaud-content-host.example"]
}
```

This is an illustrative origin, not a real Plaud storage host. Verify the actual storage origin before approving it. No arbitrary S3/CDN wildcard is trusted, and action input cannot expand the allowlist. Without approval, the result has `status: "link_requires_approval"`, `content: null`, and `contentUrl`; it does not silently report a missing transcript.

Approved downloads send no Plaud bearer or cookies, refuse redirects, time out after 20 seconds, and are bounded to 8 MiB. Transcript JSON is decoded into `content`; plain text remains a string. Summary content remains text/Markdown. Missing blocks or empty content return `status: "unavailable"`. Errors do not include signed URLs or raw provider bodies.

Recordings, note blocks, and signed URLs are private application output, not redacted diagnostics. Do not log them as credential metadata. URL allowlists alone do not prevent DNS rebinding/private-IP access; hosted deployments must enforce egress at the privileged transport boundary. Builtins still run in the trusted caller runtime; the Vex broker is separate future work.

## Sources

- [Official CLI documentation](https://docs.plaud.ai/plaud-mcp-cli/cli)
- Published `@plaud-ai/cli@0.3.13`: third-party OAuth endpoints, user/file routes, response fields, and inline/linked block behavior.
