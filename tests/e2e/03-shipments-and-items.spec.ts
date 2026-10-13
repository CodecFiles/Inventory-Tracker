// Shipments to a partner, then repairs and write-offs from an item's page.
import { expect, test } from "@playwright/test";
import { choose, db, formWith, refused, saved, unitId, where } from "./helpers";

test.beforeEach(({ page }) => page.on("dialog", (d) => d.accept()));

test("ship an unconfigured router, a loose SIM, a configured router (its SIM goes along) and cables", async ({ page }) => {
  await page.goto("/shipments");
  await page.locator("summary", { hasText: "New shipment" }).click();
  const draft = formWith(page, "Create draft");
  await draft.locator("select[name=partnerId]").selectOption({ index: 1 });
  await draft.locator("input[name=courier]").fill("DHL");
  await draft.locator("button[type=submit]").click();
  await page.waitForURL(/\/shipments\/\d+$/);

  const unitSelect = page.locator("select[name=unitId]");
  const addUnit = page.locator("form", { has: unitSelect });
  expect((await unitSelect.locator("option").allTextContents()).some((o) => o.startsWith("8996800000001230005"))).toBe(false);
  for (const serial of ["1108675306", "8996800000001230007", "1108675305"]) {
    await choose(unitSelect, serial);
    await addUnit.locator("button[type=submit]").click();
    await expect(page.locator("table.tbl td", { hasText: serial })).toBeVisible();   // wait until it is on the list
  }
  const addCounted = page.locator("form", { has: page.locator("select[name=productId]") });
  await choose(addCounted.locator("select[name=productId]"), "Cat6 cable 3 m");
  await addCounted.locator("input[name=quantity]").fill("10");
  await addCounted.locator("button[type=submit]").click();
  await saved(page, "Added");

  const ship = formWith(page, "Ship it");
  await ship.locator("input[name=trackingNumber]").fill("DHL-778899");
  await ship.locator("button[type=submit]").click();
  await saved(page, "Shipped");
  for (const serial of ["1108675306", "8996800000001230007", "1108675305", "8996800000001230005"]) {
    expect(await where(serial), serial).toEqual({ status: "shipped_to_partner", place: "Doha Smart Buildings stock" });
  }
  await page.getByRole("button", { name: "Partner received it" }).click();
  await saved(page, "Marked as received");
  const [s] = await db`select status::text, tracking_number from shipments order by id desc limit 1`;
  expect(s).toEqual({ status: "received_by_partner", tracking_number: "DHL-778899" });
});

test("repair a router (its SIM kept as a spare), bring it back; a write-off needs a reason", async ({ page }) => {
  await page.goto(`/inventory/${await unitId("1108675303")}`);
  await page.locator("summary", { hasText: "Send for repair" }).click();
  const repair = formWith(page, "Send for repair");
  await repair.locator("select[name=to]").selectOption({ index: 1 });
  await repair.locator("input[name=note]").fill("No power");
  await repair.locator("button[type=submit]").click();
  await saved(page, "Sent for repair");
  expect(await where("1108675303")).toMatchObject({ status: "in_repair" });
  expect(await where("8996800000001230003")).toEqual({ status: "in_office", place: "MRD Office" });

  await page.reload();
  await formWith(page, "Back in MRD Office").locator("button[type=submit]").click();
  await saved(page, "Back in MRD Office");
  expect(await where("1108675303")).toEqual({ status: "in_office", place: "MRD Office" });

  await page.goto(`/inventory/${await unitId("1108675307")}`);
  await page.locator("summary", { hasText: "Write off" }).click();
  const off = formWith(page, "Write off");
  await off.locator("input[name=reason]").fill("x");
  await off.locator("button[type=submit]").click();
  await refused(off, "Give a reason");
  await off.locator("input[name=reason]").fill("Water damage");
  await off.locator("button[type=submit]").click();
  await saved(page, "Written off");
  expect(await where("1108675307")).toMatchObject({ status: "retired" });
  await page.reload();
  await expect(page.locator("summary", { hasText: "Send for repair" })).toHaveCount(0);
});
