import { UUID_PATTERN } from "../schemas/sessions.schema.js";

export const sessionIdParamSchema = {
  type: 'object',
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', pattern: UUID_PATTERN },
  },
} as const;