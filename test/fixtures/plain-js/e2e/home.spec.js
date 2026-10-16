const { test, expect } = require('@playwright/test');

test('home lists items', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('ul')).toBeVisible();
});
