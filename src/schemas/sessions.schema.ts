import { z } from "zod";
import { ERROR_MESSAGES } from "../constants/index.js";

export const InputBodySchema = z.object({
  content: z.string().min(1, ERROR_MESSAGES.CONTENT_NON_EMPTY),
});
