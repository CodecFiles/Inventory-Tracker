// The redesigned screens (design batch 1) show what the database holds.
import { expect, test } from "@playwright/test";
import { actAs, db, unitId, USERS } from "./helpers";

test("dashboard: lifecycle cards and category cards add up to the database", async ({ page }) => {
  await page.goto("/");
  const [{ office }] = await db`select count(*)::int as office from units u
    where u.location_id = office_location_id() and u.status = 'in_office'
      and not exists (select 1 from deployment_items i join deployments d on d.id = i.deployment_id
                      where i.unit_id = u.id and i.removed_at is null and d.status in ('draft', 'scheduled'))
      and not exists (select 1 from shipment_items i join shipments s on s.id = i.shipment_id
                      where i.unit_id = u.id and i.removed_at is null and s.status = 'draft')`;
  const officeCard = page.locator("section", { hasText: "Where everything is" }).getByRole("link", { name: /Office stock/ });
  await expect(officeCard).toContainText(String(office));

  const [{ sims }] = await db`select count(*)::int as sims from units u join products p on p.id = u.product_id
    join categories c on c.id = p.category_id where c.name = 'SIM cards' and u.status not in ('retired', 'returned_to_supplier')`;
  const simCard = page.getByLabel("Devices by category").getByRole("link", { name: /^SIM cards/ });
  await expect(simCard).toContainText(String(sims));
});

test("inventory: a category tab and a status chip filter the list", async ({ page }) => {
  await page.goto("/inventory");
  await page.getByRole("tab", { name: /^Routers/ }).click();
  await expect(page).toHaveURL(/categoryId=\d+/);
  const rows = page.locator("table.tbl tbody tr");
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allTextContents()) expect(text).toContain("Routers ·");

  await page.locator(".fchip", { hasText: "Deployed" }).first().click();
  await expect(page).toHaveURL(/status=deployed/);
  const [{ n }] = await db`select count(*)::int as n from units u join products p on p.id = u.product_id
    join categories c on c.id = p.category_id where c.name = 'Routers' and u.status = 'deployed'`;
  await expect(rows).toHaveCount(n);
});

test("device detail: a deployed router shows its facility, lifecycle and SIM; a Viewer gets no action buttons", async ({ page }) => {
  const [r] = await db`select u.id::int, u.serial_number as serial, l.name as place from units u
    join locations l on l.id = u.location_id join products p on p.id = u.product_id
    where p.requires_configuration and u.status = 'deployed' order by u.id limit 1`;
  await page.goto(`/inventory/${r.id}`);
  await expect(page.getByLabel("Key answers")).toContainText(r.place);
  await expect(page.getByLabel("Lifecycle").locator("li.cur")).toContainText("Deployed");
  await expect(page.locator(".chain")).toContainText(r.place);

  await actAs(page, USERS.viewer);
  await page.goto(`/inventory/${await unitId(r.serial)}`);
  for (const action of ["Send for repair", "Write off", "Correct this item"]) {
    await expect(page.locator("summary", { hasText: action }), action).toHaveCount(0);
  }
});
