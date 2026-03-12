# ASAP — Système Financier (Finance System)

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Client     │────▶│  Stripe API  │────▶│  Webhook        │
│   (PWA)      │     │  (encaisse)  │     │  (idempotent)   │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          ┌────────▼────────┐
                                          │  Fee Calculator  │
                                          │  (commissions)   │
                                          └────────┬────────┘
                                                   │
                                          ┌────────▼────────┐
                                          │  Ledger Writer   │
                                          │  (append-only)   │
                                          └────────┬────────┘
                                                   │
                              ┌────────────────────┼────────────────────┐
                              │                    │                    │
                     ┌────────▼──────┐   ┌────────▼──────┐   ┌────────▼──────┐
                     │  Wallet Cache  │   │  Disputes     │   │  Payouts      │
                     │  (pending/     │   │  (hold/       │   │  (batch/      │
                     │   available)   │   │   release)    │   │   mark-paid)  │
                     └───────────────┘   └───────────────┘   └───────────────┘
```

## Principes Non-Négociables

| # | Principe | Détail |
|---|----------|--------|
| P0-1 | Ledger append-only | Aucun UPDATE sur `wallet_transactions`. Corrections via `adjustment`. |
| P0-2 | Stripe = encaissement uniquement | PaymentIntent sur compte plateforme. Pas de Stripe Connect. |
| P0-3 | Tout modélisé dans le ledger | Commissions, crédits, refunds, holds, payouts. |
| P0-4 | Idempotence webhooks | Via table `stripe_events` (event_id unique). |

## Tables Clés

### `platform_fee_settings` (id=1)
Configuration des commissions plateforme :
- `booking_fee_pct` : % commission sur réservations (défaut: 10%)
- `booking_fee_fixed_cents` : frais fixes en cents
- `delivery_fee_pct` : % commission sur livraisons (défaut: 10%)
- `delivery_fee_fixed_cents` : frais fixes en cents
- `hold_days_before_available` : jours avant libération (défaut: 7)

### `wallets`
Cache matérialisé des soldes conducteur :
- `pending_cents` : montants en attente (hold J+7)
- `available_cents` : montants disponibles pour payout
- `pending_balance` / `available_balance` : versions en dollars (backward compat)

### `wallet_transactions` (Ledger)
Entrées immuables (append-only) :
- `direction` : `credit` ou `debit`
- `amount_cents` : montant en cents
- `txn_type` : type de transaction (voir ci-dessous)
- `reference_type` + `reference_id` : lien vers booking/delivery/refund/payout/dispute
- `snapshot_json` : snapshot des frais au moment du calcul

### Types de transactions (`txn_type`)

| Type | Direction | Description |
|------|-----------|-------------|
| `booking_payment` | credit | Paiement brut reçu (booking) |
| `delivery_payment` | credit | Paiement brut reçu (delivery) |
| `platform_commission` | debit | Commission plateforme prélevée |
| `driver_credit_pending` | credit | Net conducteur → pending |
| `driver_release_to_available` | credit | Libération pending → available |
| `refund` | debit | Remboursement brut |
| `refund_commission_reversal` | credit | Reversal commission (proportionnel) |
| `refund_driver_debit` | debit | Débit conducteur (proportionnel) |
| `dispute_hold` | debit | Gel des fonds (litige) |
| `dispute_release` | credit | Libération des fonds (conducteur gagne) |
| `payout` | debit | Paiement conducteur |
| `payout_reversal` | credit | Reversal payout échoué |
| `adjustment` | credit/debit | Correction manuelle |

## Workflow Paiement

### 1. Création PaymentIntent
```
POST /api/v1/payments/intent
Body: { booking_id | delivery_id }
→ Retourne: { client_secret, stripe_payment_intent_id }
```

### 2. Confirmation côté client (Stripe.js)
Le frontend confirme le paiement via `stripe.confirmPayment()`.

### 3. Webhook Stripe (`payment_intent.succeeded`)
```
1. Vérifier signature + idempotence (stripe_events)
2. Marquer payment.status = 'succeeded'
3. Marquer booking/delivery.status = 'paid'
4. Calculer frais via feeCalculator:
   - gross = montant total
   - platform_fee = round(gross * pct/100) + fixed
   - driver_net = gross - platform_fee
5. Écrire 3 entrées ledger (atomique):
   - booking_payment/delivery_payment (gross)
   - platform_commission (fee)
   - driver_credit_pending (net)
6. Mettre à jour wallet.pending_cents += driver_net
```

### 4. Confirmation manuelle (fallback)
```
POST /api/v1/payments/:id/confirm
→ Vérifie avec Stripe et déclenche le même workflow
```

## Hold & Release (J+7)

**Job CRON** : `releasePendingToAvailable.ts`

Conditions de libération :
- Booking : `status = 'completed'` ET `updated_at + hold_days <= now()`
- Delivery : `status = 'received'` ET `received_at + hold_days <= now()`
- Pas de dispute active (`status IN ('open', 'investigating')`)

Actions :
1. Trouver les `driver_credit_pending` éligibles
2. Vérifier pas déjà libéré (`driver_release_to_available` existant)
3. Écrire ledger : `driver_release_to_available`
4. Mettre à jour wallet : `pending -= amount`, `available += amount`

## Remboursements (Refunds)

```
POST /api/v1/refunds
Body: { kind, reference_id, amount_cents, reason }
```

Workflow :
1. Vérifier politique d'annulation
2. Appeler `stripe.refunds.create()`
3. Écrire ledger (3 entrées) :
   - `refund` (débit brut)
   - `refund_commission_reversal` (reversal proportionnel)
   - `refund_driver_debit` (débit conducteur proportionnel)
4. Mettre à jour wallet cache

## Litiges (Disputes)

### Ouvrir un litige
```
POST /api/v1/disputes
Body: { kind: 'booking'|'delivery', reference_id, reason }
```
→ Applique un `dispute_hold` sur le wallet conducteur

### Résoudre (admin)
```
POST /api/v1/disputes/admin/:id/resolve
Body: { outcome: 'refund_customer'|'release_to_driver'|'split', ... }
```

Outcomes :
- `release_to_driver` : libère le hold → available
- `refund_customer` : refund Stripe + ledger
- `split` : refund partiel + release partiel

## Payouts (Sans Stripe)

### Flux
1. **Éligibilité** : `GET /api/v1/admin/payouts/eligible`
   - `available_cents >= MIN_PAYOUT_AMOUNT`
   - `payout_email` renseigné
   - Pas banni

2. **Créer batch** : `POST /api/v1/admin/payout_batches`
   - Crée un batch `draft` avec payouts individuels

3. **Exécuter** : `POST /api/v1/admin/payout_batches/:id/execute`
   - Débite les wallets via ledger (`payout` debit)
   - Marque payouts comme `sent`

4. **Export CSV** : `GET /api/v1/admin/payout_batches/:id/export`
   - Pour Interac e-Transfer / Wise / virement bancaire

5. **Confirmer paiement** : `POST /api/v1/admin/payouts/:id/mark-paid`
   - Marque comme `paid`, envoie email au conducteur

6. **Échec** : `POST /api/v1/admin/payouts/:id/mark-failed`
   - Reverse le débit via `payout_reversal`
   - Recrédite `available_cents`

## Calcul des Commissions

```typescript
// Exemple: booking de 50.00 CAD, commission 10% + 0 fixe
gross_cents = 5000
platform_fee = round(5000 * 10 / 100) + 0 = 500
driver_net = 5000 - 500 = 4500

// Le conducteur reçoit 45.00 CAD (après J+7)
// La plateforme garde 5.00 CAD
```

## Réconciliation

Script de vérification :
```sql
-- Total des paiements Stripe succeeded
SELECT SUM(amount) FROM payments WHERE status = 'succeeded';

-- Total des entrées ledger (gross)
SELECT SUM(amount_cents) FROM wallet_transactions WHERE txn_type IN ('booking_payment', 'delivery_payment');

-- Ces deux totaux doivent correspondre (en cents)
```

## Migration

```bash
# Exécuter la migration
node run-migration.js database/migrations/20260304_finance_system_v1.sql
```

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `STRIPE_SECRET_KEY` | Clé secrète Stripe | — |
| `STRIPE_WEBHOOK_SECRET` | Secret webhook Stripe | — |
| `STRIPE_CURRENCY` | Devise | `CAD` |
| `MIN_PAYOUT_AMOUNT` | Montant min payout ($) | `5` |
| `HOLD_DELAY_DAYS` | Jours de rétention | `7` |
