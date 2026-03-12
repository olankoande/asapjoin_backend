# Backend Backlog — Delivery Module

## TODO

### RB-DEL-10 : Vérification éligibilité mode instant
- [ ] Ajouter champs `rating` et `completed_deliveries` au modèle `users` (ou table dédiée `driver_stats`)
- [ ] Implémenter la vérification : `driver.rating >= 4.5 && driver.completed_deliveries >= 5`
- [ ] Actuellement le mode instant est activable sans vérification (option masquée côté frontend)
- [ ] Bloquer l'activation du mode instant si le conducteur n'est pas éligible

### Notifications (Partie 7)
- [ ] Notification push/in-app : Nouvelle demande de livraison
- [ ] Notification push/in-app : Livraison acceptée
- [ ] Notification push/in-app : Livraison rejetée
- [ ] Notification push/in-app : En transit
- [ ] Notification push/in-app : Livrée
- [ ] Notification push/in-app : Réception confirmée
- [ ] Notification push/in-app : Annulée
- [ ] Notification in-app : "Trop tard avant départ" (message contextuel)

### Stripe — Intégration complète
- [x] Webhook `payment_intent.succeeded` → met à jour delivery.status = 'paid' + écrit ledger (commissions)
- [x] Refund Stripe API intégré dans disputes.service.ts (resolveDispute)
- [ ] Vérifier que le flow de paiement delivery fonctionne end-to-end avec Stripe (test E2E)

### Prisma Generate
- [ ] Exécuter `npx prisma generate` après application de la migration SQL pour régénérer le client Prisma
- [ ] Exécuter `npx prisma db push` ou appliquer la migration SQL manuellement

### Seed
- [ ] Ajouter seed pour `platform_settings` (row id=1 avec valeurs par défaut)
- [ ] Le service auto-crée la row si absente, mais un seed explicite est préférable

### OpenAPI / Swagger
- [ ] Ajouter les endpoints disputes dans openapi.yaml
- [ ] Ajouter les endpoints fee settings admin dans openapi.yaml
- [ ] Documenter les nouveaux champs wallet (pending_cents, available_cents)

### CRON Jobs
- [ ] Configurer le job `releasePendingToAvailable` en cron (toutes les heures ou quotidien)
- [ ] Configurer le job `preparePayoutEligibility` en cron

## DONE
- [x] Migration SQL : `20260303_delivery_module_v2.sql`
- [x] Migration SQL : `20260304_finance_system_v1.sql` (ledger, disputes, fee settings)
- [x] Prisma schema : `platform_settings`, `trips_delivery_mode`, champs delivery timestamps
- [x] Service `settings.service.ts` : GET/PUT platform settings
- [x] Routes admin : `GET /admin/settings`, `PUT /admin/settings`
- [x] Service `deliveries.service.ts` : toutes les règles métier RB-DEL-0 à RB-DEL-9
- [x] Controller + Routes deliveries : create, accept, reject, in-transit, delivered, confirm-receipt, cancel
- [x] Routes listing : /sent, /received, /driver
- [x] Tests unitaires : `delivery-rules.test.ts`
- [x] Module `fees/feeCalculator.ts` : calcul commissions plateforme (booking + delivery)
- [x] Module `fees/ledgerWriter.ts` : écriture ledger append-only (13 types de transactions)
- [x] `payments.service.ts` : handlePaymentSucceeded avec commissions + ledger
- [x] Job `releasePendingToAvailable.ts` : libération pending → available (J+7)
- [x] Module `disputes/` : service + routes (open, resolve, list, get)
- [x] `payouts.service.ts` : refactoré avec ledger (payout, reversal)
- [x] Routes disputes enregistrées dans app.ts
- [x] `README_FINANCE.md` : documentation complète du système financier
- [x] Tests `finance-system.test.ts` : feeCalculator, ledger principles, refund split, wallet consistency
