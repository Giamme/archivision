import Stripe from 'stripe';

let client: Stripe | null = null;

function required(name: 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The server-side Stripe client, made on first use. The secret key comes from the environment, never the browser. */
export function stripeClient(): Stripe {
  client ??= new Stripe(required('STRIPE_SECRET_KEY'), {
    apiVersion: '2024-11-20.acacia',
    maxNetworkRetries: 2,
    appInfo: { name: 'corner-shop' },
  });
  return client;
}

export function webhookSecret(): string {
  return required('STRIPE_WEBHOOK_SECRET');
}
