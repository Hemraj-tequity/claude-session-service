import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError, z } from "zod";

const { queryRaw, createSession, submitInput, attach, stop } = vi.hoisted(
  () => ({
    queryRaw: vi.fn(),
    createSession: vi.fn(),
    submitInput: vi.fn(),
    attach: vi.fn(),
    stop: vi.fn(),
  }),
);

vi.mock("../lib/logger.js", async () => {
  const pinoModule = await import("pino");
  // A real pino instance (not 'silent') so its logging methods stay spy-able,
  // writing to a stream that discards output instead of the test's stdout.
  return {
    logger: pinoModule.default({ level: "error" }, { write: () => true }),
  };
});

vi.mock("../lib/prisma.js", () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock("../sessions/SessionManager.js", () => ({
  createSession,
  submitInput,
  attach,
  stop,
}));

import { buildApp } from "../app.js";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";
const AUTH_HEADERS = { authorization: "Bearer caller-token" };

describe("buildApp", () => {
  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([{}]);
    createSession.mockReset();
    submitInput.mockReset();
    attach.mockReset();
    stop.mockReset();
  });

  it("registers the session routes under the /api/v1 prefix", async () => {
    createSession.mockResolvedValue({
      session_id: "s1",
      status: "running",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      session_id: "s1",
      status: "running",
      created_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("returns 404 for unregistered routes", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
  });

  describe("error handler", () => {
    it("converts a thrown AppError into its mapped status code and the standardized JSON body", async () => {
      stop.mockRejectedValue(
        new (await import("../lib/errors.js")).NotFoundError(
          "Session x not found",
          "SESSION_NOT_FOUND",
        ),
      );

      const app = await buildApp();
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/sessions/${VALID_UUID}`,
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: { status: false, type: "SESSION_NOT_FOUND", message: "Session x not found" },
      });
    });

    it("converts a thrown ZodError into a 400 VALIDATION_ERROR body, without leaking treeified details to the client", async () => {
      const schema = z.object({ foo: z.string() });
      const zodError = schema.safeParse({}).error as ZodError;
      createSession.mockRejectedValue(zodError);

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/sessions",
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{
        error: { status: boolean; type: string; message: string; timestamp: string };
      }>();
      expect(body.error).toEqual({
        status: false,
        type: "VALIDATION_ERROR",
        message: "Malformed request body",
        timestamp: expect.any(String) as string,
      });
    });

    it("maps Fastify's own schema-validation failures (statusCode < 500) to VALIDATION_ERROR", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/sessions/not-a-uuid/attach",
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { status: false, type: "VALIDATION_ERROR" } });
      expect(attach).not.toHaveBeenCalled();
    });

    it("maps an unrecognized thrown error to a 500 INTERNAL_ERROR body, without leaking its message", async () => {
      attach.mockRejectedValue(new Error("some internal detail that must not reach the client"));

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${VALID_UUID}/attach`,
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({
        error: {
          status: false,
          type: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
      const body = res.body;
      expect(body).not.toContain("some internal detail");
    });

    it("returns the standardized JSON body for unmatched routes", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/nope" });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: { status: false, type: "ROUTE_NOT_FOUND" },
      });
    });
  });
});
