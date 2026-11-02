import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("ThatBit branding preserves a legacy theme preference and the new choice survives reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("thatbit-theme") === null)
      localStorage.setItem("replylink-theme", "light");
  });
  await page.goto("/");
  await expect(page).toHaveTitle("ThatBit — Every reply has a replay");
  await expect(
    page.getByRole("link", { name: "ThatBit STUDIO" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("thatbit-theme")))
    .toBe("light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".brand")).toContainText("ThatBit");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/thatbit-studio-mobile.png",
    fullPage: true,
  });
  await page.goto("http://localhost:4321/");
  await expect(page).toHaveTitle("ThatBit — Every reply has a replay");
  await expect(
    page.getByRole("link", { name: "ThatBit", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Open a replay link." }),
  ).toBeVisible();
  await expect(page.locator('meta[name="thatbit-app"]')).toHaveAttribute(
    "content",
    "reader",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/thatbit-reader-mobile.png",
    fullPage: true,
  });
});
