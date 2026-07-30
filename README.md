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

| Method | Endpoint                             | Purpose                                      |
| ------ | ------------------------------------ | -------------------------------------------- |
| POST   | `/api/v1/sessions`                   | Create a new session                         |
| POST   | `/api/v1/sessions/:sessionId/input`  | Send a prompt and receive streamed responses |
| GET    | `/api/v1/sessions/:sessionId/attach` | Reattach to an existing session via SSE      |
| DELETE | `/api/v1/sessions/:sessionId`        | Stop a session                               |

---

## Assumptions & Limitations

- Designed for **single-instance deployment**.
- No authentication or authorization layer.
- Session history is stored in Postgres.
- Sessions can be resumed while the SDK transcript is available.
