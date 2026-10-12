"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/action-state";
import { receiveDelivery } from "@/server/inventory/receive";
import { requireApprovedUser } from "@/server/session";

// The Receive form sends the whole delivery at once. receiveDelivery checks the permission and every
// line, and saves all lines or none. On success, the new batch's page opens.
export async function receive(input: unknown): Promise<ActionState> {
  const user = await requireApprovedUser();
  let batchId = 0;
  const result = await runAction(async () => { batchId = (await receiveDelivery(user.id, input)).batchId; }, "Received");
  if (!result?.ok) return result;
  revalidatePath("/", "layout");
  redirect(`/batches/${batchId}?received=1`);
}
