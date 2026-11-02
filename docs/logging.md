# Application logs

Vite's automatic browser-console forwarding is explicitly disabled. Browser diagnostics go through the authenticated fixed-category endpoint; raw browser errors remain in browser developer tools.

Restart ThatBit after updating: `npm run build && npm run dev:local`. Both services write readable, timestamped logs to the same terminal, identified by `[creator]` or `[reader]`. No external logging account is required.

The default `info` level shows startup/readiness, configuration presence, HTTP mutations, OBS connection/recording/segment events, Twitch connection failures, and job progress. Warnings include rejected requests and connection gaps. Errors include failed HTTP operations and caught render, transcription, assistance, synchronization and cleanup failures. Successful GET/HEAD requests, including polling, appear at `debug` to keep normal operation readable.

For more detail, restart with:

```sh
LOG_LEVEL=debug npm run dev:local
```

Or set these in local `.env` and restart. Shell environment takes precedence:

```dotenv
LOG_LEVEL=info
LOG_FORMAT=pretty
LOG_TO_FILE=true
```

Levels: `debug`, `info`, `warn`, `error`, `silent`. CLI format: `pretty` or `json`. File output is always JSON Lines. Invalid settings fail startup with a sanitized configuration diagnostic.

| Service | Default current file |
| --- | --- |
| Creator | `.data/logs/creator.log` |
| Managed reader | `.data/reader/logs/reader.log` |
| Optional static-bundle reader | `.data/logs/static-reader.log` |

`DATA_DIR` and `READER_DATA_DIR` change the corresponding root. Each service keeps its current file plus `.1` and `.2`, rotating at 5 MiB per file (about 15 MiB per service). Files use mode 0600, newly created log directories 0700. Logs are private/ignored, excluded from collection backups and public exports, and not served by web endpoints. `LOG_TO_FILE=false` keeps CLI logging only. If file creation/writing/rotation fails, one `logging.file_unavailable` diagnostic is printed and CLI logging continues; it does not fail a save or recording operation.

Follow both files:

```sh
tail -F .data/logs/creator.log .data/reader/logs/reader.log
```

Every entry has a process `sessionId`. HTTP responses have a server-generated `X-Request-Id`; handled exception responses also include `requestId` in JSON. Caller-supplied IDs are ignored. Search the matching ID to follow an action, or search `jobId`/`publicationId` across retries. Request context follows awaited application calls; background workers correlate through job IDs, and the reader has independent request/session IDs. HTTP logs include the registered route template, method, status and duration. Job failures include attempt, retry eligibility, elapsed time, known failure codes and code locations where available.

For example, `transcription.failed` with `ENOENT` points to a missing local executable/model/source; `MEDIA_AUDIO_TRACK_MISSING` points to the selected recorded audio track; `ENOSPC` means free disk space. Unknown errors retain component/event and repository code locations without dumping exception text. Startup and unexpected uncaught/rejected failures are logged and exit unsuccessfully.

Logs omit bodies, headers, cookies, raw URLs/queries, original chat, transcript/caption text, model/recording paths, subprocess output and arbitrary exception messages—even at `debug`. The authenticated studio reports only `client.runtime_error` or `client.unhandled_rejection`, at most ten per minute; use the browser developer console for browser stack details. Reports need a working connection and creator session, so they cannot diagnose a page before authentication or while the server is unreachable. Logs provide operational evidence, not a complete audit trail or live rehearsal acceptance.


A creator `401` means the local session capability is absent or outdated; it is separate from Twitch login. Restarting the creator rotates that capability. The updated client shares a session refresh and retries private reads once without dropping draft edits. A first rejected request can still be logged during rotation. Failed mutations are never replayed automatically: review current state and retry the deliberate action if requested. Refresh an already-open tab once after installing the update.

For unmatched requests, `requestKind` is limited to `favicon`, `devtools-probe`, `asset`, `creator-api`, `public-api` or `other`. For example, `route=unmatched requestKind=creator-api status=404` indicates a missing creator endpoint; rebuild/restart matching frontend/backend versions and inspect the failed request in browser Network tools. A devtools probe is a browser tooling request. The favicon SVG and legacy `.ico` redirect now load on creator/reader. These categories help identify a future 404 without exposing IDs, paths or query strings. The original generic 404 log cannot establish which URL was requested.
