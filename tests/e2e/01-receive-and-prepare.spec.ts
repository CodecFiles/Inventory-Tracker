// Catalogue → receive a delivery → prepare routers. Every step is checked in the database.
import { expect, test } from "@playwright/test";
import { choose, db, formWith, refused, saved, unitId, where } from "./helpers";

test("add a category and product; a duplicate is refused; tracking locks once received", async ({ page }) => {
  await page.goto("/settings?tab=categories");
  const addCat = formWith(page, "Add category");
  await addCat.locator("input[name=name]").fill("Gateways");
  await addCat.locator("button[type=submit]").click();
  await saved(page, "Category added");

  await page.goto("/settings?tab=products");
  const addProduct = formWith(page, "Add product");
  const fill = async (name: string) => {
    await addProduct.locator("input[name=name]").fill(name);
    await addProduct.locator("input[name=brand]").fill("Milesight");
    await addProduct.locator("input[name=model]").fill("UG65");
    await addProduct.locator("select[name=categoryId]").selectOption({ label: "Gateways" });
  };
  await fill("UG65 LoRaWAN gateway");
  await addProduct.locator("button[type=submit]").click();
  await saved(page, "Product added");
  await fill("Same model again");
  await addProduct.locator("button[type=submit]").click();
  await refused(addProduct, "is already used");
  expect((await db`select count(*)::int as n from products where model = 'UG65'`)[0].n).toBe(1);

  await page.locator("summary", { hasText: "TRB140 LTE router" }).click();
  await expect(page.locator("details[open]").getByText("has been received, so how it is tracked can no longer change")).toBeVisible();
});

test("receive a delivery in 3 steps: a bad ICCID saves nothing; corrected, the batch is created", async ({ page }) => {
  const before = (await db`select count(*)::int as n from batches`)[0].n;
  await page.goto("/receive");
  // step 1: shipment
  await page.locator("select[name=supplierId]").selectOption({ label: "Teltonika Distributor (TEL)" });
  await page.getByRole("button", { name: /Next: Units/ }).click();
  // step 2: units, three products
  const product = (n: number) => page.getByRole("region", { name: `Product ${n}` });
  await choose(product(1).locator("select[name=productId]"), "TRB140 LTE router");
  await product(1).locator("textarea[name=serials]").fill("2200000001\n2200000002");
  await page.getByRole("button", { name: "Add another product" }).click();
  await choose(product(2).locator("select[name=productId]"), "Omantel Data SIM");
  await product(2).locator("textarea[name=serials]").fill("8996800000009990001\n12345");
  await page.getByRole("button", { name: "Add another product" }).click();
  await choose(product(3).locator("select[name=productId]"), "CO₂ sensor");
  await product(3).locator("input[name=quantity]").fill("5");
  await page.getByRole("button", { name: /Next: Review/ }).click();
  // step 3: review and confirm — the server refuses the bad ICCID and nothing is saved
  await expect(page.getByRole("region", { name: "Review" })).toContainText("2200000001 … 2200000002");
  await page.getByRole("button", { name: "Receive into MRD Office" }).click();
  await expect(page.locator(".alert.err")).toContainText('"12345" is not an ICCID');
  expect((await db`select count(*)::int as n from batches`)[0].n).toBe(before);           // nothing saved
  expect((await db`select count(*)::int as n from units where serial_number = '2200000001'`)[0].n).toBe(0);

  // back to the units, fix it, confirm again: everything typed is still there
  await page.getByRole("button", { name: "Back to the units" }).click();
  await expect(product(1).locator("textarea[name=serials]")).toHaveValue("2200000001\n2200000002");
  await product(2).locator("textarea[name=serials]").fill("8996800000009990001\n8996800000009990002");
  await page.getByRole("button", { name: /Next: Review/ }).click();
  await page.getByRole("button", { name: "Receive into MRD Office" }).click();
  await page.waitForURL(/\/batches\/\d+\?received=1/);
  await expect(page.locator(".alert.ok")).toContainText("received");
  expect(await where("2200000001")).toEqual({ status: "in_office", place: "MRD Office" });
  const [sim] = await db`select iccid from sim_details where iccid = '8996800000009990002'`;
  expect(sim.iccid).toBe("8996800000009990002");
});

test("device preparation board: SIM in, bad IP refused, SIM changed (old one spare), sensors serialised", async ({ page }) => {
  await page.goto("/prep");
  const noSim = page.getByRole("region", { name: "No SIM yet" });
  const ready = page.getByRole("region", { name: "Ready" });
  const panel = page.getByRole("dialog");

  await noSim.getByRole("article", { name: "Router 2200000001" }).getByRole("link", { name: "Prepare" }).click();
  await panel.locator("select[name=simUnitId]").selectOption({ label: "8996800000009990001" });
  await panel.locator("input[name=ipAddress]").fill("10.64.99.1");
  await panel.getByRole("button", { name: "Put SIM in" }).click();
  await saved(page, "the router is ready");
  await expect(panel).toContainText("It is ready");
  expect(await where("2200000001")).toMatchObject({ status: "configured" });
  await expect(ready.getByRole("article", { name: "Router 2200000001" })).toBeVisible();   // moved to Ready

  await page.goto("/prep");
  await noSim.getByRole("article", { name: "Router 2200000002" }).getByRole("link", { name: "Prepare" }).click();
  await panel.locator("select[name=simUnitId]").selectOption({ index: 1 });
  await panel.locator("input[name=ipAddress]").fill("10.64.999.1");
  await panel.getByRole("button", { name: "Put SIM in" }).click();
  await refused(panel, "Enter a valid IP address");
  await expect(panel.locator("input[name=ipAddress]")).toHaveValue("10.64.999.1");    // kept for fixing
  expect(await where("2200000002")).toMatchObject({ status: "in_office" });

  await page.goto("/prep");
  await ready.getByRole("article", { name: "Router 2200000001" }).getByRole("link", { name: "Change SIM" }).click();
  await panel.locator("select[name=simUnitId]").selectOption({ label: "8996800000009990002" });
  await panel.getByRole("button", { name: "Change SIM" }).click();
  await saved(page, "SIM changed");
  expect(await where("8996800000009990001")).toMatchObject({ status: "in_office" });    // spare again
  const [now] = await db`select s.serial_number from sim_assignments a join units s on s.id = a.sim_unit_id
                         where a.router_unit_id = ${await unitId("2200000001")} and a.ended_at is null`;
  expect(now.serial_number).toBe("8996800000009990002");

  await page.goto("/prep");
  const sensors = page.getByRole("region", { name: "Waiting for serial numbers" }).getByRole("article").filter({ hasText: "0 of 5" });
  await sensors.getByRole("link", { name: "Add serial numbers" }).click();
  await panel.locator("textarea[name=serials]").fill("AM-E2E-1\nAM-E2E-2");
  await panel.getByRole("button", { name: "Save serial numbers" }).click();
  await saved(page, "Serial numbers saved");
  expect((await db`select count(*)::int as n from units where serial_number like 'AM-E2E-%'`)[0].n).toBe(2);
});
