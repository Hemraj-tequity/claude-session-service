# Headless Claude Code Session Service

A Fastify + TypeScript backend that exposes Claude Code sessions over HTTP/SSE. Clients can create a session, send prompts, stream responses in real time, and resume conversations after client disconnects or service restarts.

---

## Architecture

```text
Client
   │
HTTP / SSE
   │
   ▼
Fastify API
   │
   ▼
Session Manager
   ├──────────────► Postgres
   │                (Session metadata & event history)
   │
   ▼
Claude Agent SDK
   │
   ▼
Claude subprocess
(one active process per live session)
```

---

## Key Design

- One Claude subprocess is created per active session.
- Session metadata and streamed events are persisted in Postgres.
- Active sessions are kept in memory for performance.
- Idle sessions are evicted from memory but remain resumable.
- When a session is accessed again, the SDK resumes it using the stored session history.

---

## Session Lifecycle

```text
Create Session
      │
      ▼
First Input
      │
      ▼
Start Claude Process
      │
      ▼
Stream Response (SSE)
      │
      ▼
Persist Events to Postgres
      │
      ▼
Idle Timeout
      │
      ▼
Process Evicted
      │
      ▼
Next Input / Attach
      │
      ▼
SDK Resume
      │
      ▼
Continue Conversation
```

---

## API Endpoints

All routes below require an `Authorization: Bearer <claude-token>` header carrying the caller's own Claude credential (see [Authentication](#authentication)).

| Method | Endpoint                             | Purpose                                      |
| ------ | ------------------------------------ | -------------------------------------------- |
| POST   | `/api/v1/sessions`                   | Create a new session                         |
| POST   | `/api/v1/sessions/:sessionId/input`  | Send a prompt and receive streamed responses |
| GET    | `/api/v1/sessions/:sessionId/attach` | Reattach to an existing session via SSE      |
| DELETE | `/api/v1/sessions/:sessionId`        | Stop a session                               |

---

## Authentication

There is no shared server-wide Claude credential. Every request to `/api/v1/*` must carry the caller's own token:

```
Authorization: Bearer <claude-token>
```

Missing or malformed headers get a `401 Unauthorized` before any session logic runs. The token is read fresh from each request (no global state, no singleton), passed down through the session and SDK layers, and injected into the Claude Agent SDK subprocess as `CLAUDE_CODE_AUTH_TOKEN` for that call -- so each caller's requests always run under their own Claude account. Any `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` inherited from the host process is stripped before spawning, so nothing can outrank the caller's own token.

Note: an active session's underlying Claude subprocess is spawned once and reused across subsequent `/input` calls (see Key Design above) for performance and resumability. The token supplied on whichever request causes that spawn (fresh or resumed) is the one used for the life of that subprocess; it isn't re-verified on every individual message pushed into an already-running session.

---

## Assumptions & Limitations

- Designed for **single-instance deployment**.
- Authentication is per-request via a bearer token; there is no authorization/ownership layer on top of it (any caller who knows a `sessionId` can act on it, provided they supply a valid token of their own).
- Session history is stored in Postgres.
- Sessions can be resumed while the SDK transcript is available.
