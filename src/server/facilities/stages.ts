import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import { parseInput, ValidationError } from "../errors";

// Moving a facility through its project stages (R12). The database (migration 0011) enforces the
// same rules; the checks here give clearer messages first.
//   forward one step            -> anyone with facilities.change_stage
//   forward, skipping steps     -> the same, with a reason
//   back, or re-opening closed  -> Admin / Super Admin only, with a reason
//   closed (POC not converted)  -> from any stage

export const STAGES = [
  "site_inspection", "bms_scan", "poc", "poc_study", "contract", "deployment", "active_operations", "closed",
] as const;
const label = (s: string) => s.replaceAll("_", " ");

export const ChangeStageInput = z.object({
  facilityId: z.number().int().positive(),
  toStage: z.enum(STAGES),
  reason: z.string().trim().max(2000).optional(),
});

export async function changeFacilityStage(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(ChangeStageInput, rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "facilities.change_stage");
    const [f] = await tx<{ stage: string }[]>`select stage::text from facilities where id = ${input.facilityId} for update`;
    if (!f) throw new ValidationError("That facility does not exist");
    if (f.stage === input.toStage) throw new ValidationError(`The facility is already at ${label(f.stage)}`);

    const from = STAGES.indexOf(f.stage as (typeof STAGES)[number]);
    const to = STAGES.indexOf(input.toStage);
    const forward = input.toStage === "closed" || (f.stage !== "closed" && to > from);
    if (!input.reason) {
      if (forward && input.toStage !== "closed" && to - from > 1) {
        throw new ValidationError(`Skipping ${STAGES.slice(from + 1, to).map(label).join(", ")} needs a reason`);
      }
      if (!forward) throw new ValidationError("Moving a facility back needs a reason");
    }

    // the database reads the reason from here and keeps it in the stage history
    await tx`select set_config('app.stage_note', ${input.reason ?? ""}, true)`;
    await tx`update facilities set stage = ${input.toStage} where id = ${input.facilityId}`;
  });
}
