import { Decimal } from '@prisma/client/runtime/library';

/**
 * Convert a Decimal amount to Stripe's smallest currency unit (cents).
 * e.g., 10.50 CAD => 1050 cents
 */
export function toStripeCents(amount: Decimal | number | string): number {
  const dec = new Decimal(amount);
  return dec.mul(100).toNumber();
}

/**
 * Convert Stripe cents back to a Decimal amount.
 * e.g., 1050 cents => 10.50
 */
export function fromStripeCents(cents: number): Decimal {
  return new Decimal(cents).div(100);
}

/**
 * Safe Decimal addition.
 */
export function addDecimals(a: Decimal | number | string, b: Decimal | number | string): Decimal {
  return new Decimal(a).add(new Decimal(b));
}

/**
 * Safe Decimal subtraction.
 */
export function subDecimals(a: Decimal | number | string, b: Decimal | number | string): Decimal {
  return new Decimal(a).sub(new Decimal(b));
}

/**
 * Safe Decimal multiplication.
 */
export function mulDecimals(a: Decimal | number | string, b: Decimal | number | string): Decimal {
  return new Decimal(a).mul(new Decimal(b));
}

/**
 * Calculate percentage of an amount.
 * e.g., percentOf(100, 15) => 15.00
 */
export function percentOf(amount: Decimal | number | string, percentage: Decimal | number | string): Decimal {
  return new Decimal(amount).mul(new Decimal(percentage)).div(100);
}

/**
 * Round a Decimal to 2 decimal places.
 */
export function roundMoney(amount: Decimal): Decimal {
  return new Decimal(amount.toFixed(2));
}
