// Users & roles, corrections, the audit log — and what a Viewer can and cannot do.
import { expect, test } from "@playwright/test";
import { actAs, db, formWith, saved, unitId, USERS, where } from "./helpers";

test.beforeEach(({ page }) => page.on("dialog", (d) => d.accept()));

test("approve a sign-up, change roles, disable and enable, give an Admin permissions", async ({ page }) => {
  await page.goto("/admin/users");
  const waiting = page.locator(".row", { hasText: "New Person" });
  await waiting.locator("select[name=role]").selectOption("editor");
  await waiting.getByRole("button", { name: "Approve" }).click();
  await saved(page, "Approved");
  await expect(page.locator("tr", { hasText: "(you)" })).toContainText("You cannot change yourself");

  const vik = () => page.locator("tr", { hasText: "Vik Viewer" });
  await vik().locator("button", { hasText: "Disable" }).click();
  await saved(page, "Disabled");
  expect((await db`select status::text from users where id = ${USERS.viewer}`)[0].status).toBe("disabled");
  await vik().getByRole("button", { name: "Enable" }).click();
  await saved(page, "Enabled again");

  const sara = () => page.locator("tr", { hasText: "Sara Editor" });
  await sara().locator("select[name=role]").selectOption("admin");
  await sara().getByRole("button", { name: "Save role" }).click();
  await saved(page, "Role changed");
  await sara().locator("summary", { hasText: "Admin permissions" }).click();
  await sara().locator("input[value='audit.view']").check();
  await sara().getByRole("button", { name: "Save permissions" }).click();
  await saved(page, "Permissions saved");
  const perms = await db`select permission_key from user_permissions where user_id = ${USERS.editor}`;
  expect(perms.map((p) => p.permission_key)).toEqual(["audit.view"]);
  // put Sara back as an Editor for the next tests
  await sara().locator("select[name=role]").selectOption("editor");
  await sara().getByRole("button", { name: "Save role" }).click();
  await saved(page, "Role changed");
});

test("corrections: counted stock +2 with a reason; a written-off router corrected back; both in the audit log", async ({ page }) => {
  const officeCables = async () => (await db`select s.quantity from stock_levels s join products p on p.id = s.product_id
                                             where p.model = 'CAT6-3M' and s.location_id = office_location_id()`)[0].quantity;
  const before = await officeCables();
  await page.goto("/corrections");
  const fix = formWith(page, "Record correction");
  await fix.locator("select[name=productId]").selectOption({ label: "Cat6 cable 3 m" });
  await fix.locator("input[name=amount]").fill("2");
  await fix.locator("input[name=reason]").fill("Monthly recount");
  await fix.locator("button[type=submit]").click();
  await saved(page, "Correction recorded");
  expect(await officeCables()).toBe(before + 2);

  await page.goto(`/inventory/${await unitId("1108675307")}`);   // written off in the previous test file
  await page.locator("summary", { hasText: "Correct this item" }).click();
  const item = formWith(page, "Record correction");
  await item.locator("select[name=status]").selectOption("in_office");
  await item.locator("input[name=reason]").fill("Found in the store room");
  await item.locator("button[type=submit]").click();
  await saved(page, "Correction recorded");
  expect(await where("1108675307")).toMatchObject({ status: "in_office" });

  await page.goto("/audit?table=users");
  await expect(page.locator("td", { hasText: "status: approved → disabled" }).first()).toBeVisible();
});

test("a Viewer sees no editing screens and is refused if they open one directly", async ({ page }) => {
  await actAs(page, USERS.viewer);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "All inventory" })).toBeVisible();
  for (const hidden of ["Receive stock", "Device preparation", "Users & roles", "Settings", "Corrections", "Audit log"]) {
    await expect(nav.getByRole("link", { name: hidden }), hidden).toHaveCount(0);
  }
  for (const [path, message] of [
    ["/receive", "You do not have permission to receive stock"],
    ["/prep", "You do not have permission to prepare devices"],
    ["/admin/users", "You do not have permission to manage users"],
    ["/corrections", "Only a Super Admin can record corrections"],
  ]) {
    await page.goto(path);
    await expect(page.locator(".alert.err"), path).toContainText(message);
  }
  // the item page offers no actions to a Viewer
  await page.goto(`/inventory/${await unitId("1108675308")}`);
  await expect(page.locator("summary", { hasText: "Write off" })).toHaveCount(0);
});
