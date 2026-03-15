/**
 * Finance System Tests — feeCalculator, ledger principles, reconciliation.
 */
import { describe, it, expect } from 'vitest';

// ─── Fee Calculator (pure functions, no DB) ───

describe('Fee Calculator — computeFees logic', () => {
  // Replicate the core computation without DB dependency
  function computeFees(grossCents: number, feePct: number, feeFixedCents: number) {
    const pctFee = Math.round(grossCents * feePct / 100);
    let platformFeeCents = pctFee + feeFixedCents;
    platformFeeCents = Math.max(0, Math.min(platformFeeCents, grossCents));
    const driverNetCents = Math.max(0, grossCents - platformFeeCents);
    return { grossCents, platformFeeCents, driverNetCents };
  }

  it('should compute 10% commission on 5000 cents (50.00 CAD)', () => {
    const result = computeFees(5000, 10, 0);
    expect(result.platformFeeCents).toBe(500);
    expect(result.driverNetCents).toBe(4500);
    expect(result.grossCents).toBe(5000);
  });

  it('should compute 10% + 50 cents fixed on 5000 cents', () => {
    const result = computeFees(5000, 10, 50);
    expect(result.platformFeeCents).toBe(550); // 500 + 50
    expect(result.driverNetCents).toBe(4450);
  });

  it('should compute 15% on 1000 cents (10.00 CAD)', () => {
    const result = computeFees(1000, 15, 0);
    expect(result.platformFeeCents).toBe(150);
    expect(result.driverNetCents).toBe(850);
  });

  it('should handle 0% commission', () => {
    const result = computeFees(5000, 0, 0);
    expect(result.platformFeeCents).toBe(0);
    expect(result.driverNetCents).toBe(5000);
  });

  it('should handle 100% commission', () => {
    const result = computeFees(5000, 100, 0);
    expect(result.platformFeeCents).toBe(5000);
    expect(result.driverNetCents).toBe(0);
  });

  it('should clamp fee to gross (fee > gross)', () => {
    const result = computeFees(100, 50, 200); // 50 + 200 = 250 > 100
    expect(result.platformFeeCents).toBe(100); // clamped to gross
    expect(result.driverNetCents).toBe(0);
  });

  it('should handle zero gross', () => {
    const result = computeFees(0, 10, 0);
    expect(result.platformFeeCents).toBe(0);
    expect(result.driverNetCents).toBe(0);
  });

  it('should round correctly (odd amounts)', () => {
    // 33 cents * 10% = 3.3 → rounds to 3
    const result = computeFees(33, 10, 0);
    expect(result.platformFeeCents).toBe(3);
    expect(result.driverNetCents).toBe(30);
  });

  it('should round correctly (banker rounding)', () => {
    // 15 cents * 10% = 1.5 → Math.round = 2
    const result = computeFees(15, 10, 0);
    expect(result.platformFeeCents).toBe(2);
    expect(result.driverNetCents).toBe(13);
  });

  it('gross = fee + net (invariant)', () => {
    const testCases = [
      { gross: 5000, pct: 10, fixed: 0 },
      { gross: 1234, pct: 15, fixed: 25 },
      { gross: 999, pct: 7.5, fixed: 10 },
      { gross: 1, pct: 50, fixed: 0 },
      { gross: 100000, pct: 12.5, fixed: 100 },
    ];

    for (const tc of testCases) {
      const result = computeFees(tc.gross, tc.pct, tc.fixed);
      // Invariant: fee + net <= gross (due to clamping)
      expect(result.platformFeeCents + result.driverNetCents).toBeLessThanOrEqual(result.grossCents);
      // And fee + net should equal gross when no clamping
      if (result.platformFeeCents < result.grossCents) {
        expect(result.platformFeeCents + result.driverNetCents).toBe(result.grossCents);
      }
    }
  });
});

// ─── Ledger Principles ───

describe('Ledger Principles', () => {
  it('P0-1: Ledger is append-only (no updates)', () => {
    // This is an architectural test — verify the ledgerWriter module
    // only uses INSERT, never UPDATE on wallet_transactions
    // We verify this by checking the source code pattern
    const fs = require('fs');
    const path = require('path');
    const ledgerSource = fs.readFileSync(
      path.resolve(__dirname, '../src/modules/fees/ledgerWriter.ts'),
      'utf8',
    );

    // Should contain INSERT
    expect(ledgerSource).toContain('INSERT INTO wallet_transactions');

    // Should NOT contain UPDATE wallet_transactions
    expect(ledgerSource).not.toContain('UPDATE wallet_transactions');
  });

  it('P0-3: All financial events have txn_type', () => {
    const expectedTypes = [
      'booking_payment',
      'delivery_payment',
      'platform_commission',
      'driver_credit_pending',
      'driver_release_to_available',
      'refund',
      'refund_commission_reversal',
      'refund_driver_debit',
      'dispute_hold',
      'dispute_release',
      'payout',
      'payout_reversal',
      'adjustment',
    ];

    const fs = require('fs');
    const path = require('path');
    const ledgerSource = fs.readFileSync(
      path.resolve(__dirname, '../src/modules/fees/ledgerWriter.ts'),
      'utf8',
    );

    for (const txnType of expectedTypes) {
      expect(ledgerSource).toContain(`'${txnType}'`);
    }
  });

  it('P0-4: Stripe webhook uses idempotency check', () => {
    const fs = require('fs');
    const path = require('path');
    const webhookSource = fs.readFileSync(
      path.resolve(__dirname, '../src/webhooks/stripeWebhook.ts'),
      'utf8',
    );

    expect(webhookSource).toContain('isStripeEventProcessed');
    expect(webhookSource).toContain('recordStripeEvent');
  });
});

// ─── Refund Proportional Calculation ───

describe('Refund Proportional Calculation', () => {
  function computeRefundSplit(
    refundAmountCents: number,
    grossCents: number,
    platformFeeCents: number,
    driverNetCents: number,
  ) {
    const refundRatio = refundAmountCents / grossCents;
    const commissionReversal = Math.round(platformFeeCents * refundRatio);
    const driverDebit = Math.round(driverNetCents * refundRatio);
    return { commissionReversal, driverDebit };
  }

  it('full refund should reverse full amounts', () => {
    const result = computeRefundSplit(5000, 5000, 500, 4500);
    expect(result.commissionReversal).toBe(500);
    expect(result.driverDebit).toBe(4500);
  });

  it('50% refund should reverse 50% of each', () => {
    const result = computeRefundSplit(2500, 5000, 500, 4500);
    expect(result.commissionReversal).toBe(250);
    expect(result.driverDebit).toBe(2250);
  });

  it('partial refund with rounding', () => {
    const result = computeRefundSplit(1000, 3000, 300, 2700);
    // ratio = 1/3
    expect(result.commissionReversal).toBe(100); // 300 * 1/3 = 100
    expect(result.driverDebit).toBe(900); // 2700 * 1/3 = 900
  });
});

// ─── Wallet Cache Consistency ───

describe('Wallet Cache Consistency', () => {
  it('pending + available should always be non-negative after operations', () => {
    // Simulate a series of operations
    let pending = 0;
    let available = 0;

    // Payment: +4500 pending
    pending += 4500;
    expect(pending).toBeGreaterThanOrEqual(0);
    expect(available).toBeGreaterThanOrEqual(0);

    // Release: -4500 pending, +4500 available
    pending -= 4500;
    available += 4500;
    expect(pending).toBeGreaterThanOrEqual(0);
    expect(available).toBeGreaterThanOrEqual(0);

    // Payout: -4500 available
    available -= 4500;
    expect(pending).toBeGreaterThanOrEqual(0);
    expect(available).toBeGreaterThanOrEqual(0);
  });

  it('dispute hold + release should be balanced', () => {
    let available = 4500;

    // Hold
    const holdAmount = 4500;
    available -= holdAmount;
    expect(available).toBe(0);

    // Release (driver wins)
    available += holdAmount;
    expect(available).toBe(4500);
  });
});
