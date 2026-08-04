import type { FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { ZodError, treeifyError } from "zod";

export interface AppErrorOptions {
  cause?: unknown;
  logDetails?: unknown;
}

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

abstract class ConfigurableTypeError extends AppError {
  readonly type: string;

  constructor(message: string, type: string, options?: AppErrorOptions) {
    super(message, options);
    this.type = type;
  }
}

// ---------------------------------------------------------------------------
// Fixed type + fixed status — no per-instance configuration needed.
// ---------------------------------------------------------------------------

export class ValidationError extends AppError {
  readonly type = "VALIDATION_ERROR";
  readonly statusCode = 400;
}

export class UnauthorizedError extends AppError {
  readonly type = "UNAUTHORIZED";
  readonly statusCode = 401;
}

export class PersistenceError extends AppError {
  readonly type = "DATABASE_ERROR";
  readonly statusCode = 500;
}

export class ChunkError extends AppError {
  readonly type = "CHUNK_ERROR";
  readonly statusCode = 500;
}

export class InternalServerError extends AppError {
  readonly type = "INTERNAL_ERROR";
  readonly statusCode = 500;

  constructor(message = "An unexpected error occurred", options?: AppErrorOptions) {
    super(message, options);
  }
}

// ---------------------------------------------------------------------------
// Configurable type, fixed status — share the constructor via ConfigurableTypeError.
// ---------------------------------------------------------------------------

export class NotFoundError extends ConfigurableTypeError {
  readonly statusCode = 404;

  constructor(message: string, type = "NOT_FOUND", options?: AppErrorOptions) {
    super(message, type, options);
  }
}

export class ConflictError extends ConfigurableTypeError {
  readonly statusCode = 409;

  constructor(message: string, type = "CONFLICT", options?: AppErrorOptions) {
    super(message, type, options);
  }
}

// ---------------------------------------------------------------------------
// Both type and status are configurable.
// ---------------------------------------------------------------------------

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

export class ClaudeAuthError extends ClaudeSdkError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, { ...options, type: "CLAUDE_AUTH_ERROR", statusCode: 401 });
  }
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

export interface ErrorResponseBody {
  error: {
    status: false;
    type: string;
    message: string;
    timestamp: string;
  };
}

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

// ---------------------------------------------------------------------------
// Normalization: turn any thrown value into an AppError
// ---------------------------------------------------------------------------

const PRISMA_ERROR_TYPES = [
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientUnknownRequestError,
] as const;

function isPrismaError(err: unknown): boolean {
  return PRISMA_ERROR_TYPES.some((ErrorClass) => err instanceof ErrorClass);
}

function hasClientStatusCode(err: unknown): err is { statusCode: number } {
  const statusCode = (err as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === "number" && statusCode < 500;
}

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

  if (hasClientStatusCode(err)) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return new ValidationError(message, { cause: err });
  }

  return new InternalServerError(undefined, { cause: err });
}

// ---------------------------------------------------------------------------
// Fastify integration
// ---------------------------------------------------------------------------

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