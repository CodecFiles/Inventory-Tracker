import "server-only";
import type { z } from "zod";

// Errors the server returns to the user. Anything else is an unexpected failure: it is logged on
// the server and the user only sees a generic message, so internal details never leak.

export class ForbiddenError extends Error {
  readonly kind = "forbidden";
}

export class ValidationError extends Error {
  readonly kind = "validation";
}

type PgError = { code?: string; detail?: string; message?: string; constraint_name?: string };

// Turns database rule violations into messages a person can act on.
export function fromDatabaseError(error: unknown): Error {
  const e = error as PgError;
  switch (e?.code) {
    case "23505": // unique_violation
      return new ValidationError(`Already exists: ${e.detail ?? "a duplicate value"}`);
    case "23514": // check_violation (includes our trigger rules)
      if (e.constraint_name === "stock_levels_quantity_check") {
        return new ValidationError("Not enough stock for this — someone may have just used it. Refresh and check the numbers.");
      }
      return new ValidationError(e.message ?? "A rule was broken");
    case "23503": // foreign_key_violation
      return new ValidationError("A referenced record does not exist or is still in use");
    case "42501": // insufficient_privilege (our permission triggers)
      return new ForbiddenError(e.message ?? "Not allowed");
    default:
      return error instanceof Error ? error : new Error(String(error));
  }
}

// Checks form input against a zod schema; on failure, one readable message listing every problem.
export function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
