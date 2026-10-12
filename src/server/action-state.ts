import "server-only";
import { ForbiddenError, ValidationError } from "./errors";

// What a form gets back after a server action: a message to show, and whether it worked.
export type ActionState = { ok: boolean; message: string } | null;

// Runs an action and turns its outcome into a message for the person.
// Rule violations (ValidationError / ForbiddenError) are shown as they are — they are written for
// people. Anything unexpected is logged on the server and shown only as a generic message, so
// internal details (database errors, stack traces) never reach the browser.
export async function runAction(action: () => Promise<unknown>, success: string): Promise<ActionState> {
  try {
    await action();
    return { ok: true, message: success };
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ForbiddenError) return { ok: false, message: e.message };
    console.error("Unexpected error in a server action", e);
    return { ok: false, message: "Something went wrong and nothing was saved. Please try again." };
  }
}
