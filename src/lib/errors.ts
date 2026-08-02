import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, treeifyError } from "zod";

export type ErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "SESSION_NOT_FOUND"
  | "SESSION_STOPPED"
  | "CLAUDE_AUTH_ERROR"
  | "STREAM_ERROR"
  | "PERSIST_FAILED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  SESSION_NOT_FOUND: 404,
  SESSION_STOPPED: 409,
  CLAUDE_AUTH_ERROR: 401,
  STREAM_ERROR: 500,
  PERSIST_FAILED: 500,
  INTERNAL_ERROR: 500,
};

// Domain error carrying a machine-readable code and the HTTP status it maps to.
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }
}

// Builds the standard JSON error response body for a given error code and message.
export function errorBody(code: ErrorCode, message: string, details?: unknown) {
  return {
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
    },
  };
}

// Sends an AppError to the client with its mapped status code and JSON body.
export function sendError(reply: FastifyReply, err: AppError): void {
  reply
    .code(err.statusCode)
    .send(errorBody(err.code, err.message, err.details));
}

// Fastify error handler that converts any thrown error into a consistent JSON error response.
export function fastifyErrorHandler(
  err: FastifyError | AppError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (err instanceof AppError) {
    sendError(reply, err);
    return;
  }
  if (err instanceof ZodError) {
    reply
      .code(400)
      .send(
        errorBody("INVALID_INPUT", "Malformed request body", treeifyError(err)),
      );
    return;
  }

  const statusCode = err.statusCode;
  if (typeof statusCode === "number" && statusCode < 500) {
    reply.code(statusCode).send(errorBody("INVALID_INPUT", err.message));
    return;
  }
  request.log.error({ err }, "unhandled error");
  reply
    .code(500)
    .send(errorBody("INTERNAL_ERROR", "An unexpected error occurred"));
}
