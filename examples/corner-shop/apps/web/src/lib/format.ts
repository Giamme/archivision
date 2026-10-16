// Values for people (money, dates, statuses) and values from people (form fields, typed amounts).
const LOCALE = 'en-IE';

export function formatMoney(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(cents / 100);
}

export function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

const STATUS: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  SHIPPED: 'On its way',
  CANCELLED: 'Cancelled',
};

export function orderStatusLabel(status: string): string {
  return STATUS[status] ?? status.toLowerCase();
}

/** Euros typed by staff ("12,50" or "12.50") to cents; null when it is not an amount. */
export function parseEuros(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

// ---------- reading FormData in server actions: every value is a string or a File, or missing ----------

/** A trimmed text field; '' when it is missing. */
export function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** A trimmed text field, or null when it is empty. */
export function optional(formData: FormData, name: string): string | null {
  return text(formData, name) || null;
}

export function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on' || formData.get(name) === 'true';
}

/** A whole number field; null when it is empty or not a whole number. */
export function integer(formData: FormData, name: string): number | null {
  const raw = text(formData, name);
  if (!/^-?\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}
