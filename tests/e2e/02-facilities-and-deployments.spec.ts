// Facilities → stage rules → deployment → return. Every step is checked in the database.
import { expect, test } from "@playwright/test";
import { choose, db, formWith, refused, saved, where } from "./helpers";

test("add a facility; a skip needs a reason, and a refused form keeps what was chosen", async ({ page }) => {
  await page.goto("/facilities");
  await page.locator("summary", { hasText: "Add a facility" }).click();
  const add = formWith(page, "Add facility");
  await add.locator("input[name=name]").fill("Lulu Salalah");
  await add.locator("select[name=clientId]").selectOption({ label: "Lulu Hypermarket" });
  await add.locator("input[name=city]").fill("Salalah");
  await add.locator("button[type=submit]").click();
  await page.waitForURL(/\/facilities\/\d+$/);

  const stage = formWith(page, "Change stage");
  await stage.locator("select[name=toStage]").selectOption("contract");
  await stage.locator("button[type=submit]").click();
  await refused(stage, "needs a reason");
  // regression test (Stage 6.4): a refused form must not reset — the choice stays "contract"
  await expect(stage.locator("select[name=toStage]")).toHaveValue("contract");
  await stage.locator("input[name=reason]").fill("Client signed without a POC");
  await stage.locator("button[type=submit]").click();
  await saved(page, "Stage changed");

  const [f] = await db`select stage::text from facilities where name = 'Lulu Salalah'`;
  expect(f.stage).toBe("contract");
  const [h] = await db`select note from facility_stage_history h join facilities f on f.id = h.facility_id
                       where f.name = 'Lulu Salalah' and h.to_stage = 'contract'`;
  expect(h.note).toBe("Client signed without a POC");
});

test("deploy a router and cables; too many is refused with nothing moved; then complete and return", async ({ page }) => {
  await page.goto("/facilities");
  await page.getByRole("link", { name: "Lulu Salalah" }).click();
  await page.waitForURL(/\/facilities\/\d+$/);
  const facilityUrl = page.url();
  await page.locator("main").getByRole("link", { name: "New deployment" }).first().click();   // not the top bar one
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/deployments\/\d+$/);

  const unitSelect = page.locator("select[name=unitId]");
  const options = await unitSelect.locator("option").allTextContents();
  expect(options.some((o) => o.includes("1108675306") && o.includes("needs a SIM first"))).toBe(true);
  const addUnit = page.locator("form", { has: unitSelect });
  await choose(unitSelect, "1108675304");
  await addUnit.locator("input[name=position]").fill("Roof");
  await addUnit.locator("button[type=submit]").click();
  await saved(page, "Added");

  const addCounted = page.locator("form", { has: page.locator("select[name=productId]") });
  await choose(addCounted.locator("select[name=productId]"), "Cat6 cable 3 m");
  await addCounted.locator("input[name=quantity]").fill("500");
  await addCounted.locator("button[type=submit]").click();
  await saved(page, "Added");

  page.on("dialog", (d) => d.accept());
  const complete = formWith(page, "Complete deployment");
  await complete.locator("button[type=submit]").click();
  await refused(complete, /Not enough stock: Cat6 cable 3 m \(need 500/);
  expect(await where("1108675304")).toEqual({ status: "configured", place: "MRD Office" });   // nothing moved

  await page.locator("tr", { hasText: "500" }).getByRole("button", { name: "Remove" }).click();
  await saved(page, "Removed");
  await choose(addCounted.locator("select[name=productId]"), "Cat6 cable 3 m");
  await addCounted.locator("input[name=quantity]").fill("4");
  await addCounted.locator("button[type=submit]").click();
  await saved(page, "Added");
  await complete.locator("button[type=submit]").click();
  await saved(page, "Completed");
  expect(await where("1108675304")).toEqual({ status: "deployed", place: "Lulu Salalah" });
  expect(await where("8996800000001230004")).toEqual({ status: "deployed", place: "Lulu Salalah" });   // its SIM went along

  await page.goto(facilityUrl);
  await expect(page.locator("tr", { hasText: "1108675304" })).toContainText("10.64.12.34");
  await page.locator("tr", { hasText: "1108675304" }).locator("input[name=unit]").check();
  await page.locator("input[name=note]").fill("POC finished early");
  await page.getByRole("button", { name: "Return ticked items to MRD Office" }).click();
  await saved(page, "Returned to MRD Office");
  expect(await where("1108675304")).toEqual({ status: "configured", place: "MRD Office" });
  expect(await where("8996800000001230004")).toEqual({ status: "configured", place: "MRD Office" });
});
