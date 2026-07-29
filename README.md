# Headless Claude Code Session Service

A Fastify + TypeScript backend that sits between HTTP/SSE clients and Claude Code,
exposing session management over HTTP instead of a terminal or IDE. Clients create a
session, send it prompts, and stream Claude's responses back in real time — with the
full conversation durably persisted so a session survives client disconnects and
service restarts.

## Architecture at a glance

```
client <--SSE/HTTP--> Fastify routes --> SessionManager --> Agent SDK query()
                                              |                     |
                                              v                     v
                                         Postgres            claude subprocess
                                    (sessions, history,      (one per live session,
                                     transcripts)             + its own local
                                                               ~/.claude/projects/*.jsonl)
```

- Each session runs as its own lightweight `claude` subprocess managed by this one
  Node process — **not** one container/pod per session. This targets a single EC2
  instance handling dozens of concurrent sessions.
- Postgres is the durable source of truth for conversation history and the full
  structured event stream. The Agent SDK's own `resume: sessionId` mechanism (backed
  by its local `~/.claude/projects/<cwd>/<sessionId>.jsonl` transcript on the same
  host) is the fast path for continuing a session's actual model context; Postgres
  is what survives client disconnects, gives you a full audit/replay trail, and lets
  the service resurrect a session after its own restart.
- A session's in-memory footprint (the OS subprocess) is evicted after a period of
  inactivity to bound resource usage, but the session stays fully resumable — the
  next `/input` or `/attach` call transparently respawns it via `resume`.

## Prerequisites on the target EC2 instance

1. Provision an EC2 instance (Amazon Linux 2023 or Ubuntu 22.04/24.04). Open inbound
   TCP for `PORT` (default 3000), or front it with nginx/ALB — if fronting with
   nginx, disable response buffering for the SSE routes (this service already sends
   `X-Accel-Buffering: no`, but nginx's own `proxy_buffering off;` is still needed).
2. Install Node.js 20.19+ (via NodeSource or nvm).
3. Install the Claude Code CLI globally — this is separate from the npm dependency
   `@anthropic-ai/claude-agent-sdk` used by this service:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
4. Run `claude login` **once, interactively, on this specific instance.**
   Credentials are stored per-host (`~/.claude/.credentials.json` on Linux). They are
   **not** shareable across instances — if you deploy to multiple EC2 instances,
   each one needs its own `claude login` (or its own `ANTHROPIC_API_KEY`). Do not
   try to copy the credentials file between hosts as a shortcut.
   - Alternative to interactive login: set `ANTHROPIC_API_KEY` (or
     `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`) as an environment variable
     instead. The service checks for either at startup.
5. Provision a Postgres database (RDS or self-managed), Postgres 13+. This service
   does not create the database for you — just point `DATABASE_URL` at an existing one.

## Clone & install

```bash
git clone <this-repo-url>
cd claude-test
npm install
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *(required)* | Postgres connection string |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `ALLOWED_TOOLS` | *(empty)* | Comma-separated tool allow-list (e.g. `Read,Grep,Glob`). Also restricts which tools are even defined for the model — expand deliberately per deployment, don't default to broad shell/write access. |
| `DISALLOWED_TOOLS` | *(empty)* | Comma-separated tool deny-list |
| `SYSTEM_PROMPT` | *(unset)* | Optional system prompt override |
| `SESSION_IDLE_EVICT_MS` | `600000` (10 min) | How long an idle, unattached session stays resident in memory before its subprocess is evicted (still resumable afterward) |
| `SSE_HEARTBEAT_MS` | `15000` | Heartbeat interval on an idle-but-attached SSE stream, to survive intermediary idle timeouts |
| `SESSION_MAX_BUDGET_USD` | *(unset)* | Optional per-turn cost cap forwarded to the Agent SDK. Enforced by the SDK **after** a turn completes, not pre-flight — treat as a backstop, not a hard guarantee (see Known limitations) |
| `LOG_LEVEL` | `info` | pino log level |
| `CORS_ORIGIN` | *(unset)* | If set, enables CORS for this origin. Unset disables CORS entirely |

## Build & migrate

```bash
npm run build
npx prisma migrate deploy
npx prisma generate
```

## Start

```bash
npm start
```

Example systemd unit:

```ini
[Unit]
Description=Claude headless session service
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/claude-session-service
EnvironmentFile=/etc/claude-session-service.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
User=claude-svc

[Install]
WantedBy=multi-user.target
```

## Verify

```bash
curl -s http://localhost:3000/health
# {"status":"ok","db":"ok","claudeAuth":"ok","uptimeSeconds":...}

SID=$(curl -s -X POST http://localhost:3000/api/v1/sessions | jq -r .session_id)
echo "$SID"

# -N disables curl's output buffering so SSE frames print as they arrive
curl -N -X POST "http://localhost:3000/api/v1/sessions/$SID/input" \
  -H 'Content-Type: application/json' \
  -d '{"content":"Reply with exactly one word: pong"}'
# data: {"type":"system_init",...}
# data: {"type":"chunk","content":"p",...}
# data: {"type":"chunk","content":"ong",...}
# data: {"type":"result","content":"pong","isError":false,...}
# data: {"type":"done",...}

# Reattach mid-session (e.g. after a client disconnect) -- replays everything
# persisted so far, then holds the connection open if the session is idle.
curl -N "http://localhost:3000/api/v1/sessions/$SID/attach"

curl -X DELETE "http://localhost:3000/api/v1/sessions/$SID"
# {"session_id":"...","status":"stopped"}

# A stopped session still replays its full history via /attach (one-shot, no process):
curl -N "http://localhost:3000/api/v1/sessions/$SID/attach"
```

## Local development

```bash
cp .env.example .env   # fill in DATABASE_URL
npm run prisma:migrate:dev
npm run dev             # tsx watch, restarts on file change
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/sessions` | Create a session. Returns `{session_id, status, created_at}` immediately — no subprocess is spawned until the first `/input` or `/attach`. |
| POST | `/api/v1/sessions/:sessionId/input` | Send a prompt. Body: `{"content": "<prompt>"}`. Response is an SSE stream. |
| GET | `/api/v1/sessions/:sessionId/attach` | Reattach an SSE stream to an existing session (running or stopped). Only one SSE reader is active per session at a time — a new `/attach` or `/input` always takes over, closing whatever was previously attached. |
| DELETE | `/api/v1/sessions/:sessionId` | Stop a session and mark it `stopped`. |

### SSE event types

```
data: {"type":"system_init","timestamp":"...","model":"...","tools":[...]}
data: {"type":"chunk","timestamp":"...","content":"partial text"}
data: {"type":"tool_use","timestamp":"...","toolUseId":"...","toolName":"...","input":{...}}
data: {"type":"tool_result","timestamp":"...","toolUseId":"...","content":"...","isError":false}
data: {"type":"result","timestamp":"...","content":"final text","isError":false,"numTurns":1}
data: {"type":"error","timestamp":"...","content":"...","code":"STREAM_ERROR"}
data: {"type":"done","timestamp":"..."}
```

### Error responses

```json
{"error":{"code":"SESSION_NOT_FOUND","message":"...","details":null,"timestamp":"..."}}
```

| HTTP | Code | Scenario |
|---|---|---|
| 400 | `INVALID_INPUT` | Missing/malformed prompt or session ID |
| 404 | `SESSION_NOT_FOUND` | Unknown session ID |
| 409 | `SESSION_STOPPED` | Action attempted on an already-stopped session |
| 401 | `CLAUDE_AUTH_ERROR` | Host Claude authentication failed or expired mid-session |
| 500 | `STREAM_ERROR` | SSE connection failed/interrupted mid-stream, or the underlying session process crashed |
| 500 | `PERSIST_FAILED` | *(extension beyond the 5 codes above)* A durable Postgres write failed after 3 retries — the session is stopped rather than continuing without persistence |
| 500 | `INTERNAL_ERROR` | *(extension)* Generic catch-all for anything else unexpected |

## Known limitations / out of scope

- **No per-user auth or ownership.** A session ID is the sole access credential —
  anyone who has it can drive or attach to that session. Add an auth layer in front
  of this service if that's not acceptable for your deployment.
- **Single-instance only.** Each EC2 instance needs its own independent
  `claude login` (or API key); there is no shared/centralized credential store, and
  no built-in mechanism for load-balancing sessions across multiple instances.
- **No automated cleanup of the SDK's own local transcripts**
  (`~/.claude/projects/<cwd>/<sessionId>.jsonl`, which expire on their own default
  30-day schedule) or of this service's Postgres rows. Plan separate retention for
  the `session_history`/`session_transcripts` tables if you need one — the service
  currently keeps every row indefinitely (`DELETE /sessions/:id` only flips
  `status` to `stopped`, it doesn't remove data).
- **`SESSION_MAX_BUDGET_USD` is a backstop, not a hard cap.** The Agent SDK enforces
  it after a turn completes, not pre-flight — a single expensive turn (e.g. one that
  triggers a large system-prompt cache-creation cost) can still exceed it before the
  cap takes effect. Don't rely on it as a precise billing guarantee.
- **Attach replay resends the full raw event stream**, including every individual
  `chunk` delta recorded during the original turn (not just the consolidated final
  text). This is correct but can be verbose for long sessions; a future optimization
  could collapse replay into consolidated per-turn events instead of literal
  chunk-by-chunk replay.
- **No automated test suite** in this pass — verification is via the manual curl/SSE
  walkthrough above.
