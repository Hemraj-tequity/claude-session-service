import type { FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { ZodError, treeifyError } from "zod";

export interface AppErrorOptions {
  /** The underlying error this one was translated from, kept for logging only. */
  cause?: unknown;
  /** Extra context to log alongside the error; never sent to API clients. */
  logDetails?: unknown;
}

/**
 * Base class for every error the application throws on purpose.
 * `type` is the stable, machine-readable code exposed to API clients;
 * `statusCode` is the HTTP status the global error handler will use.
 */
export abstract class AppError extends Error {
  abstract readonly type: string;
  abstract readonly statusCode: number;
  readonly logDetails?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.logDetails = options.logDetails;
  }
}

/** Malformed or semantically invalid request input (body, params, query). */
export class ValidationError extends AppError {
  readonly type = "VALIDATION_ERROR";
  readonly statusCode = 400;
}

/** Missing, malformed, or rejected caller credentials. */
export class UnauthorizedError extends AppError {
  readonly type = "UNAUTHORIZED";
  readonly statusCode = 401;
}

/** A requested resource does not exist. `type` defaults to NOT_FOUND but callers should pass a specific code. */
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly type: string;

  constructor(message: string, type = "NOT_FOUND", options?: AppErrorOptions) {
    super(message, options);
    this.type = type;
  }
}

/** The request conflicts with the resource's current state. `type` defaults to CONFLICT but callers should pass a specific code. */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly type: string;

  constructor(message: string, type = "CONFLICT", options?: AppErrorOptions) {
    super(message, options);
    this.type = type;
  }
}

/** A datastore operation (Prisma, filesystem, etc.) failed. */
export class PersistenceError extends AppError {
  readonly type = "DATABASE_ERROR";
  readonly statusCode = 500;
}

/** The Claude Agent SDK failed to start or run. Defaults to a 502 (upstream failure). */
export class ClaudeSdkError extends AppError {
  readonly type: string;
  readonly statusCode: number;

  constructor(
    message: string,
    options: AppErrorOptions & { type?: string; statusCode?: number } = {},
  ) {
    super(message, options);
    this.type = options.type ?? "CLAUDE_SDK_ERROR";
    this.statusCode = options.statusCode ?? 502;
  }
}

/** The Claude Agent SDK rejected the caller's credentials. */
export class ClaudeAuthError extends ClaudeSdkError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, { ...options, type: "CLAUDE_AUTH_ERROR", statusCode: 401 });
  }
}

/** A streamed response (e.g. SSE) broke down mid-transfer. */
export class ChunkError extends AppError {
  readonly type = "CHUNK_ERROR";
  readonly statusCode = 500;
}

/** Fallback for anything unclassified. Never exposes the original error's details. */
export class InternalServerError extends AppError {
  readonly type = "INTERNAL_ERROR";
  readonly statusCode = 500;

  constructor(message = "An unexpected error occurred", options?: AppErrorOptions) {
    super(message, options);
  }
}

export interface ErrorResponseBody {
  error: {
    status: false;
    type: string;
    message: string;
    timestamp: string;
  };
}

/** Builds the standardized JSON error response body sent to every API client. */
export function buildErrorResponse(err: AppError): ErrorResponseBody {
  return {
    error: {
      status: false,
      type: err.type,
      message: err.message,
      timestamp: new Date().toISOString(),
    },
  };
}

function isPrismaError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientUnknownRequestError
  );
}

/**
 * Converts any error - ours, Prisma's, Fastify's, Zod's, or an unclassified
 * throwable - into an AppError so the global handler has one shape to format.
 */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new ValidationError("Malformed request body", {
      cause: err,
      logDetails: treeifyError(err),
    });
  }

  if (isPrismaError(err)) {
    return new PersistenceError("A database error occurred", { cause: err });
  }

  const statusCode = (err as { statusCode?: unknown })?.statusCode;
  if (typeof statusCode === "number" && statusCode < 500) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return new ValidationError(message, { cause: err });
  }

  return new InternalServerError(undefined, { cause: err });
}

/** Global Fastify error handler: normalizes any error and sends the standardized response body. */
export function fastifyErrorHandler(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const appError = normalizeError(err);

  request.log.error(
    { err, type: appError.type, statusCode: appError.statusCode, logDetails: appError.logDetails },
    "request failed",
  );

  reply.code(appError.statusCode).send(buildErrorResponse(appError));
}

/** Global Fastify not-found handler, kept on the same standardized response shape. */
export function fastifyNotFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  const appError = new NotFoundError(
    `Route ${request.method} ${request.url} not found`,
    "ROUTE_NOT_FOUND",
  );
  reply.code(appError.statusCode).send(buildErrorResponse(appError));
}
