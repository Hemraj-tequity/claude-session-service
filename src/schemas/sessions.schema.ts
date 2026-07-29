import { z } from 'zod';

export const InputBodySchema = z.object({
  content: z.string().min(1, 'content must be a non-empty string'),
});

export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
