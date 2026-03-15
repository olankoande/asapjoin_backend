# Moteur d'Annulation & Remboursement — ASAP

## Vue d'ensemble

Le système d'annulation et de remboursement ASAP gère les annulations de **bookings** (réservations de places) et de **deliveries** (livraisons de colis) avec un moteur de politique paramétrable, des remboursements Stripe, et une correction comptable dans le ledger interne.

## Architecture

```
backend/src/modules/cancellations/
├── refundPolicyService.ts    # Résolution et CRUD des politiques
├── refundCalculator.ts       # Calcul des montants (cents, déterministe)
├── cancellationService.ts    # Orchestration cancel + refund + ledger
└── cancellations.routes.ts   # Endpoints Express

backend/src/modules/fees/
└── ledgerWriter.ts           # Écritures ledger append-only (refund entries)

backend/database/migrations/
└── 20260305_cancellation_refund_engine.sql  # Tables refund_policies + cancellation_requests
```

## Tables

### `refund_policies`
Politique paramétrable par acteur et type de ressource.

| Champ | Type | Description |
|-------|------|-------------|
| `resource_type` | ENUM('booking','delivery') | Type de ressource |
| `actor_role` | ENUM('passenger','sender','driver','admin') | Qui annule |
| `min_hours_before_departure` | INT | Heures min avant départ pour annuler |
| `refund_request_deadline_hours` | INT | Heures max après événement pour demander remboursement |
| `cancellation_fee_fixed_cents` | INT | Frais fixes en cents |
| `cancellation_fee_percent` | DECIMAL(5,2) | Frais en % du montant brut |
| `refund_percent_to_customer` | DECIMAL(5,2) | % remboursé au client (après frais) |
| `driver_compensation_percent` | DECIMAL(5,2) | % du net conducteur conservé en compensation |
| `applies_when_statuses` | TEXT | CSV des statuts autorisés |
| `priority` | INT | Priorité (plus élevé = prioritaire) |

### `cancellation_requests`
Journal des demandes d'annulation et décisions.

| Champ | Type | Description |
|-------|------|-------------|
| `resource_type` | ENUM('booking','delivery') | Type |
| `resource_id` | BIGINT | ID de la ressource |
| `actor_user_id` | BIGINT | Qui a demandé |
| `actor_role` | ENUM | Rôle de l'acteur |
| `status` | ENUM | requested → approved/rejected/refunded/closed |
| `calculated_refund_cents` | INT | Montant calculé |
| `policy_snapshot_json` | TEXT | Snapshot JSON de la politique appliquée |

## Endpoints

### Annulation

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/api/v1/bookings/:id/cancel-preview` | Preview des frais d'annulation |
| `POST` | `/api/v1/bookings/:id/cancel` | Annuler un booking |
| `GET` | `/api/v1/deliveries/:id/cancel-preview` | Preview des frais d'annulation |
| `POST` | `/api/v1/deliveries/:id/cancel` | Annuler une delivery |

### Admin — Politiques

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/api/v1/admin/refund-policies` | Lister les politiques |
| `POST` | `/api/v1/admin/refund-policies` | Créer une politique |
| `PATCH` | `/api/v1/admin/refund-policies/:id` | Modifier une politique |
| `POST` | `/api/v1/admin/refund-policies/:id/activate` | Activer |
| `POST` | `/api/v1/admin/refund-policies/:id/deactivate` | Désactiver |

### Admin — Override

| Méthode | URL | Description |
|---------|-----|-------------|
| `POST` | `/api/v1/admin/refunds/override` | Forcer un remboursement |

## Flux d'annulation

```
1. Client appelle GET /cancel-preview
   → Résolution de la politique applicable
   → Calcul des montants (preview)
   → Retour: allowed, refund_amount, fee, message

2. Client appelle POST /cancel
   → Validation des fenêtres temporelles
   → Calcul des montants
   → Création cancellation_request
   → Si paiement Stripe existant:
     a. Vérification idempotence (pas de double refund)
     b. Création Stripe refund
     c. Écritures ledger append-only:
        - refund (négatif)
        - platform_commission_reversal
        - driver_pending_reversal / driver_available_reversal
        - driver_compensation (si applicable)
     d. Mise à jour wallet conducteur
   → Mise à jour statut booking/delivery → 'cancelled'
   → Retour: cancellation_request_id, status, amounts
```

## Calcul des montants

Tous les calculs sont en **cents (INT)**, jamais de float pour les montants finaux.

### Formule

```
cancellation_fee = fixed_fee + round(gross * fee_percent / 100)
after_fee = gross - cancellation_fee
refund_to_customer = round(after_fee * refund_percent / 100)
refund_ratio = refund_to_customer / gross
commission_reversal = round(platform_fee * refund_ratio)
driver_reversal = round(driver_net * refund_ratio)
driver_compensation = round(driver_net * compensation_percent / 100)
```

### Exemples

**Passager annule >24h avant départ (100% remboursement)**
```
Gross: 4000¢, Fee: 400¢, Driver net: 3600¢
→ Refund: 4000¢, Commission reversal: 400¢, Driver reversal: 3600¢
```

**Passager annule <6h avant départ (50% + frais 500¢)**
```
Gross: 4000¢, Fee: 400¢, Driver net: 3600¢
→ Cancel fee: 500¢, After fee: 3500¢
→ Refund: 1750¢ (50%), Driver compensation: 900¢ (25%)
```

## Fenêtres temporelles

### Fenêtre d'annulation (`min_hours_before_departure`)
- Si `min_hours = 0` : annulation toujours possible
- Si `min_hours = 24` : annulation refusée si < 24h avant départ
- Admin : toujours autorisé

### Fenêtre de demande de remboursement (`refund_request_deadline_hours`)
- Si `deadline = 0` : pas de limite
- Si `deadline = 48` : demande refusée si > 48h après l'événement
- Code erreur : `REFUND_REQUEST_WINDOW_EXPIRED`

## Conducteur déjà payé


