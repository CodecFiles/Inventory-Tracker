"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/action-state";
import { archiveRecord, createRecord, restoreRecord, updateRecord, type CatalogueEntity } from "@/server/catalogue/catalogue";
import { checked, num, text } from "@/server/form-values";
import { requireApprovedUser } from "@/server/session";

// Settings forms → catalogue functions (src/server/catalogue). Each action finds the signed-in user
// first; the catalogue function then checks the permission and validates every field.

const productFields = (f: FormData) => ({
  name: text(f, "name"), brand: text(f, "brand"), model: text(f, "model"), categoryId: num(f, "categoryId"),
  trackingType: text(f, "trackingType"), requiresConfiguration: checked(f, "requiresConfiguration"),
  isSim: checked(f, "isSim"), minStockLevel: num(f, "minStockLevel") ?? 0, description: text(f, "description"),
});

async function save(kind: CatalogueEntity, values: Record<string, unknown>, done: string, id?: number): Promise<ActionState> {
  const user = await requireApprovedUser();
  const result = await runAction(
    () => (id ? updateRecord(user.id, kind, { id, ...values }) : createRecord(user.id, kind, values)), done);
  if (result?.ok) revalidatePath("/settings");
  return result;
}

export async function addProduct(_: ActionState, f: FormData) {
  return save("product", productFields(f), "Product added");
}
export async function editProduct(id: number, _: ActionState, f: FormData) {
  return save("product", productFields(f), "Product saved", id);
}
export async function addCategory(_: ActionState, f: FormData) {
  return save("category", { name: text(f, "name") }, "Category added");
}
export async function renameCategory(id: number, _: ActionState, f: FormData) {
  return save("category", { name: text(f, "name") }, "Category renamed", id);
}
const supplierFields = (f: FormData) => ({
  name: text(f, "name"), codePrefix: text(f, "codePrefix"), email: text(f, "email"), phone: text(f, "phone"),
});
export async function addSupplier(_: ActionState, f: FormData) {
  return save("supplier", supplierFields(f), "Supplier added");
}
export async function editSupplier(id: number, _: ActionState, f: FormData) {
  return save("supplier", supplierFields(f), "Supplier saved", id);
}
export async function addRepairCompany(_: ActionState, f: FormData) {
  return save("repairCompany", { name: text(f, "name"), email: text(f, "email"), phone: text(f, "phone") }, "Repair company added");
}

// Archive hides a record from new work; restore brings it back. Nothing is ever deleted.
export async function setArchived(kind: CatalogueEntity, id: number, archived: boolean): Promise<ActionState> {
  const user = await requireApprovedUser();
  const result = await runAction(
    () => (archived ? archiveRecord(user.id, kind, { id }) : restoreRecord(user.id, kind, { id })),
    archived ? "Archived" : "Restored");
  if (result?.ok) revalidatePath("/settings");
  return result;
}
