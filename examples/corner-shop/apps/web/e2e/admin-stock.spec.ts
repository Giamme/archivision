import { expect, test, type BrowserContext } from '@playwright/test';
import { createSession } from '@corner/auth';
import { prisma } from '@corner/db';

// The seeded staff member; the session is made directly, so the spec never goes through Google.
async function signInAsStaff(context: BrowserContext): Promise<void> {
  const staff = await prisma.staffMember.findUniqueOrThrow({ where: { email: 'staff@example.com' } });
  const { token } = await createSession({ staffId: staff.id });
  await context.addCookies([{ name: 'cs_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('back office stock', () => {
  test('without a staff session the back office goes to Google sign-in', async ({ page }) => {
    const response = await page.request.get('/admin/stock', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain('/api/staff/sign-in');
  });

  test('staff set a counted quantity', async ({ page, context }) => {
    await signInAsStaff(context);
    await page.goto('/admin/stock');
    const row = page.getByRole('row', { name: /MUG-SLATE/ });
    await row.getByLabel('On hand for MUG-SLATE').fill('40');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('cell').nth(3)).toHaveText(/^\d+$/);

    await page.goto('/products/stoneware-mug');
    await expect(page.getByLabel('Slate')).toBeEnabled();
  });

  test('staff find a SKU', async ({ page, context }) => {
    await signInAsStaff(context);
    await page.goto('/admin/stock?q=TOTE');
    await expect(page.getByRole('row', { name: /TOTE-NAT/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /MUG-SAND/ })).toHaveCount(0);
  });
});
