// The subjects on the Corner Shop bus (NATS) and what each one carries; the port numbers are the ones in the
// README's event table. The Lambda services read order.confirmed and parcel.shipped through the bus's SQS bridge,
// so these payloads are also the JSON the Python code parses: keep both sides in step.

export const SUBJECTS = {
  stockChanged: 'stock.changed', // port 1 · catalog → web shop (cache refresh)
  paymentSucceeded: 'payment.succeeded', // port 2 · payments → orders
  paymentFailed: 'payment.failed', // port 2 · payments → orders
  orderConfirmed: 'order.confirmed', // port 3 · orders → fulfilment, notifier
  parcelShipped: 'parcel.shipped', // port 4 · fulfilment → notifier
} as const;

export type Subject = (typeof SUBJECTS)[keyof typeof SUBJECTS];

/** Every field is always there; the optional ones are null when empty (the Python services read them by key). */
export interface ShippingAddress {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
}

export interface StockChanged {
  sku: string;
  productSlug: string;
  onHand: number;
  reserved: number;
  available: number;
  changedAt: string;
}

export interface PaymentSucceeded {
  paymentId: string;
  checkoutId: string;
  stripeIntentId: string;
  amountCents: number;
  currency: string;
}

export interface PaymentFailed {
  paymentId: string;
  checkoutId: string;
  stripeIntentId: string;
  failureCode: string | null;
}

export interface OrderConfirmed {
  orderId: string;
  orderNumber: string;
  email: string;
  totalCents: number;
  currency: string;
  shipping: ShippingAddress;
  lines: Array<{ sku: string; name: string; quantity: number; weightGrams: number; totalCents: number }>;
  placedAt: string;
}

export interface ParcelShipped {
  orderId: string;
  orderNumber: string;
  email: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  shippedAt: string;
}

/** Subject → payload, so publish('order.confirmed', …) only accepts an OrderConfirmed. */
export interface Payloads {
  'stock.changed': StockChanged;
  'payment.succeeded': PaymentSucceeded;
  'payment.failed': PaymentFailed;
  'order.confirmed': OrderConfirmed;
  'parcel.shipped': ParcelShipped;
}
