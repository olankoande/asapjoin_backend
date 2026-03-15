# AsapJoin Backend API

API REST complète pour la plateforme de covoiturage AsapJoin.

## Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js 5
- **ORM**: Prisma (DB-first, MySQL 8)
- **Auth**: JWT (access + refresh tokens)
- **Paiements**: Stripe (PaymentIntents + webhooks)
- **Validation**: Zod
- **Documentation**: OpenAPI 3.0 + Swagger UI
- **Jobs**: node-cron (dev) / scripts npm (prod)

## Installation

```bash
# 1. Installer les dépendances
cd backend
npm install

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos valeurs (DB, Stripe, JWT, etc.)

# 3. Générer le client Prisma depuis la DB existante
npx prisma db pull
npx prisma generate
```

## Démarrage

```bash
# Développement (hot reload)
npm run dev

# Production
npm run build
npm start
```

Le serveur démarre sur `http://localhost:3000` par défaut.

## Documentation API

- **Swagger UI**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **OpenAPI JSON**: [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)
- **Health check**: [http://localhost:3000/health](http://localhost:3000/health)

## Endpoints principaux

### Auth
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/v1/auth/register` | Inscription |
| POST | `/api/v1/auth/login` | Connexion |
| POST | `/api/v1/auth/refresh` | Rafraîchir le token |
| POST | `/api/v1/auth/forgot-password` | Mot de passe oublié |
| POST | `/api/v1/auth/reset-password` | Réinitialiser le mot de passe |

### Users
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/me` | Mon profil |
| PATCH | `/api/v1/me` | Modifier mon profil |

### Vehicles
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/vehicles` | Mes véhicules |
| POST | `/api/v1/vehicles` | Ajouter un véhicule |
| PATCH | `/api/v1/vehicles/:id` | Modifier |
| DELETE | `/api/v1/vehicles/:id` | Supprimer |

### Trips
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/v1/trips` | Créer un trajet |
| PATCH | `/api/v1/trips/:id` | Modifier (draft) |
| PATCH | `/api/v1/trips/:id/publish` | Publier |
| PATCH | `/api/v1/trips/:id/unpublish` | Dépublier |
| GET | `/api/v1/trips/:id` | Détails |
| GET | `/api/v1/trips/search` | Rechercher |

### Bookings
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/v1/bookings` | Réserver (avec verrouillage seats) |
| GET | `/api/v1/bookings/:id` | Détails |
| GET | `/api/v1/me/bookings` | Mes réservations |
| GET | `/api/v1/me/driver/bookings` | Réservations sur mes trajets |
| PATCH | `/api/v1/bookings/:id/accept` | Accepter |
| PATCH | `/api/v1/bookings/:id/reject` | Refuser |
| PATCH | `/api/v1/bookings/:id/cancel` | Annuler |

### Deliveries
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/v1/deliveries` | Demander une livraison |
| GET | `/api/v1/deliveries/:id` | Détails |
| GET | `/api/v1/me/deliveries/sent` | Mes envois |
| GET | `/api/v1/me/deliveries/received` | Mes réceptions |
| PATCH | `/api/v1/deliveries/:id/accept` | Accepter |
| PATCH | `/api/v1/deliveries/:id/reject` | Refuser |
| PATCH | `/api/v1/deliveries/:id/cancel` | Annuler |
| PATCH | `/api/v1/deliveries/:id/mark-in-transit` | En transit |
| PATCH | `/api/v1/deliveries/:id/mark-delivered` | Livré |
| POST | `/api/v1/deliveries/:id/confirm-delivery` | Confirmer |

### Payments
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/v1/payments/intent` | Créer PaymentIntent Stripe |
| POST | `/api/v1/payments/webhook` | Webhook Stripe (idempotent) |
| GET | `/api/v1/payments/:id` | Détails paiement |

### Wallet
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/me/wallet` | Mon portefeuille |
| GET | `/api/v1/me/wallet/transactions` | Historique transactions |

### Admin
| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST/PATCH | `/api/v1/admin/policies/cancellation` | Politiques d'annulation |
| POST | `/api/v1/admin/policies/cancellation/:id/activate` | Activer |
| GET | `/api/v1/admin/eligible` | Utilisateurs éligibles payout |
| POST | `/api/v1/admin/payout-batches` | Créer batch payout |
| GET | `/api/v1/admin/payout-batches/:id` | Détails batch |
| POST | `/api/v1/admin/payout-batches/:id/execute` | Exécuter batch |
| POST | `/api/v1/admin/payouts/:id/retry` | Réessayer payout |
| POST | `/api/v1/admin/payouts/:id/mark-paid` | Marquer payé |
| GET | `/api/v1/admin/reports` | Signalements |
| POST | `/api/v1/admin/reports/:id/resolve` | Résoudre |

### Messaging & Reviews
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/conversations` | Mes conversations |
| POST | `/api/v1/conversations/:id/messages` | Envoyer message |
| GET | `/api/v1/conversations/:id/messages` | Messages |
| POST | `/api/v1/reviews` | Laisser un avis |
| GET | `/api/v1/users/:id/reviews` | Avis d'un utilisateur |
| POST | `/api/v1/reports` | Signaler un utilisateur |

## Règles métier critiques

1. **CANNOT_BOOK_OWN_TRIP**: Un conducteur ne peut pas réserver son propre trajet (403)
2. **CANNOT_REQUEST_DELIVERY_ON_OWN_TRIP**: Un conducteur ne peut pas envoyer un colis sur son propre trajet (403)
3. **Verrouillage des sièges**: `SELECT ... FOR UPDATE` dans une transaction MySQL pour empêcher le surbooking
4. **Webhook idempotent**: Les événements Stripe sont enregistrés dans `stripe_events` (unicité sur `stripe_event_id`)
5. **Wallet ledger immuable**: `wallet_transactions` est insert-only, toutes les écritures via transaction MySQL
6. **Annulation**: Calcul des frais selon `cancellation_policies` + `cancellation_policy_rules`
7. **Payout**: Vérification `phone_number` et `payout_email` obligatoires, batch + execute + PAYOUT_DEBIT

## Stripe Webhook (local)

```bash
# Installer Stripe CLI
# https://stripe.com/docs/stripe-cli

# Écouter les webhooks en local
stripe listen --forward-to localhost:3000/api/v1/payments/webhook

# Copier le webhook secret (whsec_...) dans .env
```

## Jobs (Cron)

Les jobs sont exécutés automatiquement via `node-cron` en dev :
- **02:00** - `releasePendingToAvailable`: Libère les fonds pending → available après `HOLD_DELAY_DAYS`
- **03:00** - `preparePayoutEligibility`: Vérifie l'éligibilité des payouts

En production, utiliser des cron externes :
```bash
npm run job:release
npm run job:payout
```

## Variables d'environnement

Voir `.env.example` pour la liste complète.

## Tests

```bash
npm test          # Exécuter les tests
npm run test:watch  # Mode watch
```

## Architecture

```
backend/
├── prisma/schema.prisma          # Schéma DB (généré via db pull)
├── src/
│   ├── app.ts                    # Express app setup
│   ├── server.ts                 # Server + cron jobs
│   ├── config/                   # env, logger
│   ├── db/                       # Prisma client
│   ├── middlewares/               # auth, rbac, validate, errorHandler, rateLimit
│   ├── utils/                    # errors, idempotency, money, dates
│   ├── modules/
│   │   ├── auth/                 # register, login, refresh, forgot/reset password
│   │   ├── users/                # profile CRUD
│   │   ├── vehicles/             # vehicle CRUD
│   │   ├── trips/                # trip CRUD + search + publish
│   │   ├── bookings/             # booking with seat locking
│   │   ├── deliveries/           # delivery lifecycle
│   │   ├── payments/             # Stripe PaymentIntents
│   │   ├── wallet/               # wallet + transactions
│   │   ├── policies/             # cancellation policies (admin)
│   │   ├── payouts/              # payout batches (admin)
│   │   ├── messaging/            # conversations + messages
│   │   ├── reviews/              # reviews
│   │   ├── admin/                # reports
│   │   └── notifications/        # email service
│   ├── webhooks/                 # Stripe webhook handler
│   ├── jobs/                     # Cron jobs
│   └── openapi/                  # OpenAPI spec
└── tests/                        # Integration tests
```
