# Plaud

Native, read-only Runline actions for recordings in a personal Plaud account. No MCP server, Plaud CLI process, borrowed client credentials, or reads from `~/.plaud/tokens.json`.

Uses Plaud's **third-party API** at `https://platform.plaud.ai/developer/api/open/third-party/`. This is not the Plaud Embedded partner API or unofficial `api.plaud.ai` device/product API.

## Authentication

`runline auth plaud` performs the same flow as Plaud's official CLI: the **published public OAuth client** (`client_f9e0b214-…`), PKCE with S256, no client secret, and Plaud's fixed loopback callback `http://localhost:8199/auth/callback`. Runline listens on both `127.0.0.1` and `::1` because browsers resolve `localhost` to either. Port 8199 must be free (another `plaud login` or `plaud-mcp` may hold it).

```sh
runline auth plaud
```

Set `PLAUD_CLIENT_ID` (or `--client-id`) to use a different public client registered for that callback. There is no secret to supply; refresh uses only the refresh token at a separate endpoint.

The host can also seed a connection directly with `refreshToken`, or a cached `accessToken` and optional `accessTokenExpiresAt` (epoch milliseconds). Environment hints for explicit CLI/file connections are `PLAUD_REFRESH_TOKEN` and `PLAUD_ACCESS_TOKEN`; the in-memory SDK never reads them implicitly. Runline never reads `~/.plaud/tokens.json`.

Host connection updates coordinate renewal and commit before resource use; one rejected GET can renew/replay. No network, rate-limit, server-error, or failed-refresh retries.

**Live-verified** (2026-09-16): browser login, every action, and refresh renewal against the production API. Observed tokens: access valid 24 hours, refresh valid 7 days, and refresh rotates both. A connection idle for more than 7 days must log in again.

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
  "contentOrigins": ["https://apse1-prod-plaud-content-storage.s3-accelerate.amazonaws.com"]
}
```

That origin was observed on a production account; other regions may use a different bucket, so confirm it from `note.list` before approving. In practice transcripts and summaries arrive inline and the link is rarely needed. No arbitrary S3/CDN wildcard is trusted, and action input cannot expand the allowlist. Without approval, the result has `status: "link_requires_approval"`, `content: null`, and `contentUrl`; it does not silently report a missing transcript.

Approved downloads send no Plaud bearer or cookies, refuse redirects, time out after 20 seconds, and are bounded to 8 MiB. Transcript JSON is decoded into `content`; plain text remains a string. Summary content remains text/Markdown. Missing blocks or empty content return `status: "unavailable"`. Errors do not include signed URLs or raw provider bodies.

Recordings, note blocks, and signed URLs are private application output, not redacted diagnostics. Do not log them as credential metadata. URL allowlists alone do not prevent DNS rebinding/private-IP access; hosted deployments must enforce egress at the privileged transport boundary. Builtins still run in the trusted caller runtime; the Vex broker is separate future work.

## Sources

- [Official CLI documentation](https://docs.plaud.ai/plaud-mcp-cli/cli)
- Published `@plaud-ai/cli@0.3.13`: third-party OAuth endpoints, user/file routes, response fields, and inline/linked block behavior.
