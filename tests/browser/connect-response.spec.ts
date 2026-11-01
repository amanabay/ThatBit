import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openInbox(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Received chat/ }).click();
  const inbox = page.getByRole("region", { name: "Received chat inbox" });
  await inbox.getByLabel("Search messages", { exact: true }).fill("duck");
  await expect(inbox.locator(".inbox-message")).toHaveCount(1);
  return inbox;
}

test("missing footage offers Add recording instead of a disabled wait cursor", async ({
  page,
}) => {
  await page.route("**/api/creator/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ json: { ...state, assets: [], obsSegments: [] } });
  });
  const inbox = await openInbox(page);
  const add = inbox.getByRole("button", { name: /^Add recording/ });
  await expect(add).toBeEnabled();
  expect(await add.evaluate((button) => getComputedStyle(button).cursor)).toBe(
    "pointer",
  );
  await add.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("connect reports a row error, shows real saving progress and opens the acknowledged private draft", async ({
  page,
}) => {
  const inbox = await openInbox(page);
  await inbox
    .getByRole("combobox", { name: "Recording for this exchange", exact: true })
    .selectOption({ index: 1 });
  const connect = inbox.getByRole("button", { name: /^Connect response/ });
  let fail = true;
  let writes = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/creator/drafts/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    if (fail)
      return route.fulfill({
        status: 409,
        json: {
          error:
            "Recording unavailable. Choose another saved recording. [response fixture]",
        },
      });
    await held;
    await route.continue();
  });
  await connect.click();
  await expect(inbox.getByRole("alert")).toContainText(
    "Recording unavailable. Choose another saved recording.",
  );
  await expect(connect).toBeEnabled();
  fail = false;
  await connect.click();
  await expect(connect).toHaveText("Saving private exchange…");
  await expect(connect).toHaveAttribute("aria-busy", "true");
  await expect(connect).toBeDisabled();
  await expect(
    inbox.getByText("Saving this message with the selected recording…"),
  ).toBeVisible();
  expect(writes).toBe(2);
  release();
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "A reply worth keeping",
  );
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await expect(
    page
      .getByText("That tiny duck deserves its own game.", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "selected original message",
  );
});

test("an interrupted connect request times out visibly without automatic mutation retries", async ({
  page,
}) => {
  const inbox = await openInbox(page);
  await inbox
    .getByRole("combobox", { name: "Recording for this exchange", exact: true })
    .selectOption({ index: 1 });
  let writes = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/creator/drafts/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    await held;
    await route.abort();
  });
  const connect = inbox.getByRole("button", { name: /^Connect response/ });
  await connect.click();
  await expect(connect).toHaveAttribute("aria-busy", "true");
  await expect(inbox.getByRole("alert")).toContainText(
    "The draft may have been saved. Check Review exchanges before trying again.",
    { timeout: 12000 },
  );
  await expect(connect).toHaveAttribute("aria-busy", "false");
  await expect(connect).toBeEnabled();
  expect(writes).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/connect-timeout-mobile.png",
    fullPage: true,
  });
  release();
  await inbox
    .getByRole("button", { name: "Open Review exchanges", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Your review queue/ }),
  ).toBeVisible();
});
