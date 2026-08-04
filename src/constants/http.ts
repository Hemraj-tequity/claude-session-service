export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
} as const;

export const API_PREFIX_V1 = "/api/v1";

export const ROUTES = {
  SESSIONS: "/sessions",
  SESSION_INPUT: "/sessions/:sessionId/input",
  SESSION_ATTACH: "/sessions/:sessionId/attach",
  SESSION_BY_ID: "/sessions/:sessionId",
} as const;

export const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export const sessionIdParamSchema = {
  type: "object",
  required: ["sessionId"],
  properties: {
    sessionId: { type: "string", pattern: UUID_PATTERN },
  },
} as const;
