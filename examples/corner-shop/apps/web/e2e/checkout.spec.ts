import { expect, test } from '@playwright/test';

/** Stripe's documented test card, typed into the Payment Element's iframe. */
const TEST_CARD = { number: '4242 4242 4242 4242', expiry: '12 / 34', cvc: '123' };

test.describe('checkout', () => {
  test('a guest buys a mug with a test card', async ({ page }) => {
    await page.goto('/products/stoneware-mug');
    await page.getByLabel('Sand').check();
    await page.getByRole('button', { name: /Add to cart/ }).click();
    await expect(page.getByRole('status')).toContainText('in your cart');

    await page.goto('/cart');
    await expect(page.getByRole('cell', { name: /Stoneware mug/ })).toBeVisible();
    await page.getByRole('link', { name: 'Go to checkout' }).click();
    await expect(page).toHaveURL('/checkout');

    await page.getByLabel('Email, for the receipt').fill('guest@example.com');
    await page.getByLabel('Full name').fill('Guest Example');
    await page.getByLabel('Street and number').fill('1 Sample Street');
    await page.getByLabel('Postcode').fill('1011 AB');
    await page.getByLabel('City').fill('Amsterdam');
    await page.getByLabel('Country').selectOption('NL');
    await page.getByRole('button', { name: /Continue to payment/ }).click();

    const card = page.frameLocator('iframe[title*="payment"]').first();
    await card.getByLabel('Card number').fill(TEST_CARD.number);
    await card.getByLabel('Expiration date').fill(TEST_CARD.expiry);
    await card.getByLabel('Security code').fill(TEST_CARD.cvc);
    await page.getByRole('button', { name: /^Pay / }).click();

    await expect(page).toHaveURL(/\/checkout\/success\?checkout=/);
    await expect(page.getByRole('heading', { name: /Thank you|Confirming/ })).toBeVisible({ timeout: 15_000 });
  });

  test('an empty cart cannot check out', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page).toHaveURL('/cart');
    await expect(page.getByText('It is empty.')).toBeVisible();
  });

  test('a code that does not exist is refused', async ({ page }) => {
    await page.goto('/products/canvas-tote');
    await page.getByRole('button', { name: /Add to cart/ }).click();
    await page.goto('/cart');
    await page.getByLabel('Discount code').fill('NOPE-123');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('That code does not work on this cart.')).toBeVisible();
  });
});
