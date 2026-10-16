import { test } from '@playwright/test';

test('product page', async ({ page }) => { await page.goto('/products/p1'); });
test('blog', async ({ page }) => { await page.goto('/blog/2026/hello'); });
test('docs', async ({ page }) => { await page.goto('/docs'); });
