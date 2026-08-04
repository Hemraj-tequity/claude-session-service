import type { FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { ZodError, treeifyError } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../constants/index.js";

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
  readonly type = ERROR_CODES.VALIDATION_ERROR;
  readonly statusCode = HTTP_STATUS.BAD_REQUEST;
}

export class UnauthorizedError extends AppError {
  readonly type = ERROR_CODES.UNAUTHORIZED;
  readonly statusCode = HTTP_STATUS.UNAUTHORIZED;
}

export class PersistenceError extends AppError {
  readonly type = ERROR_CODES.DATABASE_ERROR;
  readonly statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

export class ChunkError extends AppError {
  readonly type = ERROR_CODES.CHUNK_ERROR;
  readonly statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

export class InternalServerError extends AppError {
  readonly type = ERROR_CODES.INTERNAL_ERROR;
  readonly statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

  constructor(message = ERROR_MESSAGES.DEFAULT_INTERNAL_ERROR, options?: AppErrorOptions) {
    super(message, options);
  }
}

// ---------------------------------------------------------------------------
// Configurable type, fixed status — share the constructor via ConfigurableTypeError.
// ---------------------------------------------------------------------------

export class NotFoundError extends ConfigurableTypeError {
  readonly statusCode = HTTP_STATUS.NOT_FOUND;

  constructor(message: string, type: string = ERROR_CODES.NOT_FOUND, options?: AppErrorOptions) {
    super(message, type, options);
  }
}

export class ConflictError extends ConfigurableTypeError {
  readonly statusCode = HTTP_STATUS.CONFLICT;

  constructor(message: string, type: string = ERROR_CODES.CONFLICT, options?: AppErrorOptions) {
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
    this.type = options.type ?? ERROR_CODES.CLAUDE_SDK_ERROR;
    this.statusCode = options.statusCode ?? HTTP_STATUS.BAD_GATEWAY;
  }
}

export class ClaudeAuthError extends ClaudeSdkError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, {
      ...options,
      type: ERROR_CODES.CLAUDE_AUTH_ERROR,
      statusCode: HTTP_STATUS.UNAUTHORIZED,
    });
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
  return typeof statusCode === "number" && statusCode < HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new ValidationError(ERROR_MESSAGES.MALFORMED_REQUEST_BODY, {
      cause: err,
      logDetails: treeifyError(err),
    });
  }

  if (isPrismaError(err)) {
    return new PersistenceError(ERROR_MESSAGES.DATABASE_ERROR, { cause: err });
  }

  if (hasClientStatusCode(err)) {
    const message = err instanceof Error ? err.message : ERROR_MESSAGES.INVALID_REQUEST;
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
    ERROR_MESSAGES.REQUEST_FAILED_LOG,
  );

  reply.code(appError.statusCode).send(buildErrorResponse(appError));
}