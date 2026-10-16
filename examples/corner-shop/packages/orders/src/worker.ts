// The Order service's process: `npm run worker --workspace @corner/orders`. It listens on the bus for the payment
// results (Confirm, then Keep) and releases checkouts whose stock hold ran out. Run as many as you like: the
// subscriptions are in one queue group, so each event is handled by one of them.
import { drain, subscribe, SUBJECTS, type PaymentFailed, type PaymentSucceeded } from '@corner/events';
import { confirmCheckout, expireCheckouts, releaseCheckout } from './confirm';

const GROUP = 'orders';
const EXPIRE_EVERY_MS = 60_000;

export async function onPaymentSucceeded(event: PaymentSucceeded): Promise<void> {
  const result = await confirmCheckout(event);
  if (result) console.info(`[orders] checkout ${event.checkoutId} kept as order ${result.orderId}`);
}

export async function onPaymentFailed(event: PaymentFailed): Promise<void> {
  await releaseCheckout(event);
  console.info(`[orders] checkout ${event.checkoutId} released (${event.failureCode ?? 'no failure code'})`);
}

async function expireLoop(): Promise<void> {
  try {
    const released = await expireCheckouts();
    if (released) console.info(`[orders] released ${released} expired checkouts`);
  } catch (err) {
    console.error('[orders] expiring checkouts failed', err);
  }
}

export async function startWorker(): Promise<() => Promise<void>> {
  await subscribe(SUBJECTS.paymentSucceeded, GROUP, onPaymentSucceeded);
  await subscribe(SUBJECTS.paymentFailed, GROUP, onPaymentFailed);
  const timer = setInterval(expireLoop, EXPIRE_EVERY_MS);
  console.info('[orders] listening for payment.succeeded and payment.failed');
  return async () => {
    clearInterval(timer);
    await drain();
  };
}

if (process.argv[1]?.endsWith('worker.ts')) {
  startWorker()
    .then(stop => {
      for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void stop().then(() => process.exit(0)));
    })
    .catch(err => {
      console.error('[orders] worker could not start', err);
      process.exit(1);
    });
}
