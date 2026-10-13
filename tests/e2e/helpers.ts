import { expect, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";

// Shared helpers for the browser tests.

// The demo database, to check what was really saved (not just what the screen says).
export const db = postgres({ database: "mrd_e2e", max: 2, onnotice: () => {} });

// Demo users from scripts/dev-seed.sql
export const USERS = {
  superAdmin: "6f1c2a3e-0000-4000-8000-000000000d01",
  editor: "6f1c2a3e-0000-4000-8000-000000000d02",
  viewer: "6f1c2a3e-0000-4000-8000-000000000d03",
} as const;

// Act as another demo user (local preview mode only; ignored in production).
export async function actAs(page: Page, userId: string) {
  await page.context().addCookies([{ name: "mrd_dev_user", value: userId, url: "http://localhost:3100" }]);
}

// Waits for the corner notice that a save worked.
export async function saved(page: Page, text: string) {
  await expect(page.locator(".toast", { hasText: text }).first()).toBeVisible();
  await page.locator(".toast button", { hasText: "Dismiss" }).click();
}

// The error a form shows when the server refused it.
export async function refused(form: Locator, text: string | RegExp) {
  await expect(form.locator(".alert.err")).toContainText(text);
}

// A form found by its submit button's text.
export const formWith = (scope: Page | Locator, button: string) =>
  scope.locator("form", { has: scope.locator(`button[type=submit]:text-is("${button}")`) });

// Picks the option whose text starts with the given words.
export async function choose(select: Locator, startsWith: string) {
  const label = (await select.locator("option").allTextContents()).find((o) => o.trim().startsWith(startsWith));
  if (!label) throw new Error(`No option starting with "${startsWith}"`);
  await select.selectOption({ label });
}

export async function unitId(serial: string): Promise<number> {
  const [row] = await db`select id::int from units where serial_number = ${serial}`;
  return row.id;
}

export async function where(serial: string) {
  const [row] = await db`select u.status::text as status, l.name as place from units u join locations l on l.id = u.location_id
                         where u.serial_number = ${serial}`;
  return row;
}
