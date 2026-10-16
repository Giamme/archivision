import { test } from '@playwright/test';

test('orders page opens', async ({ page }) => { await page.goto('/orders'); });
