import { expect, test, type BrowserContext } from '@playwright/test';
import { createSession } from '@corner/auth';
import { prisma } from '@corner/db';

// The specs run against a database with the demo catalog loaded (npm run db:seed). The session is made directly,
// so the spec never waits for an email.
async function signInAsCustomer(context: BrowserContext): Promise<void> {
  const email = 'e2e-customer@example.com';
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name: 'E2E Customer' } });
  const { token } = await createSession({ userId: user.id });
  await context.addCookies([{ name: 'cs_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('account', () => {
  test('guests are sent to sign in, and back afterwards', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount/);
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  test('a customer sees their orders', async ({ page, context }) => {
    await signInAsCustomer(context);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
  });

  test('a customer adds a default address', async ({ page, context }) => {
    await signInAsCustomer(context);
    await page.goto('/account/addresses');
    await page.getByLabel('Label (home, work…)').fill('Home');
    await page.getByLabel('Full name').fill('E2E Customer');
    await page.getByLabel('Street and number').fill('2 Example Lane');
    await page.getByLabel('Postcode').fill('D02 XY00');
    await page.getByLabel('City').fill('Dublin');
    await page.getByLabel('Use this address by default').check();
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Default')).toBeVisible();
  });

  test('an expired link says so', async ({ page }) => {
    await page.goto('/sign-in/verify?token=not-a-real-token');
    await expect(page).toHaveURL('/sign-in?expired=1');
  });
});
