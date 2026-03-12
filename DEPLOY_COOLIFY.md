# 🚀 Guide de déploiement sur Coolify — ASAP Backend

## Table des matières

1. [Prérequis](#prérequis)
2. [Architecture du déploiement](#architecture-du-déploiement)
3. [Étape 1 : Préparer le dépôt Git](#étape-1--préparer-le-dépôt-git)
4. [Étape 2 : Créer la base de données MySQL sur Coolify](#étape-2--créer-la-base-de-données-mysql-sur-coolify)
5. [Étape 3 : Créer l'application Backend](#étape-3--créer-lapplication-backend)
6. [Étape 4 : Configurer les variables d'environnement](#étape-4--configurer-les-variables-denvironnement)
7. [Étape 5 : Configurer le domaine et HTTPS](#étape-5--configurer-le-domaine-et-https)
8. [Étape 6 : Déployer](#étape-6--déployer)
9. [Étape 7 : Vérifications post-déploiement](#étape-7--vérifications-post-déploiement)
10. [Étape 8 : Seed de la base de données (optionnel)](#étape-8--seed-de-la-base-de-données-optionnel)
11. [Déploiement automatique (CI/CD)](#déploiement-automatique-cicd)
12. [Dépannage](#dépannage)

---

## Prérequis

- Un serveur avec **Coolify** installé (v4+)
- Le code source poussé sur un dépôt **Git** (GitHub, GitLab, Bitbucket, ou Gitea)
- Un **nom de domaine** pointant vers votre serveur Coolify (ex: `api.asapjoin.com`)
- Vos clés **Stripe** (test ou production)
- Votre clé **Resend** (ou autre provider email)

---

## Architecture du déploiement

```
┌─────────────────────────────────────────────┐
│                  Coolify                     │
│                                             │
│  ┌──────────────┐    ┌──────────────────┐   │
│  │   MySQL 8     │◄──│  ASAP Backend    │   │
│  │  (Database)   │   │  (Dockerfile)    │   │
│  │  Port: 3306   │   │  Port: 3000      │   │
│  └──────────────┘    └──────────────────┘   │
│                             │               │
│                      ┌──────┴──────┐        │
│                      │  Traefik    │        │
│                      │  (HTTPS)    │        │
│                      └─────────────┘        │
└─────────────────────────────────────────────┘
```

---

## Étape 1 : Préparer le dépôt Git

### 1.1 Vérifier que le Dockerfile est présent

Le projet contient déjà un `Dockerfile` multi-stage optimisé pour la production. Il :
- Installe les dépendances
- Génère le client Prisma
- Compile le TypeScript
- Exécute les migrations Prisma au démarrage
- Lance le serveur Node.js

### 1.2 Vérifier le `.gitignore`

Assurez-vous que `.env` est bien dans le `.gitignore` (c'est déjà le cas) :
```
node_modules/
dist/
.env
*.log
```

### 1.3 Pousser le code

```bash
git add .
git commit -m "ready for Coolify deployment"
git push origin main
```

---

## Étape 2 : Créer la base de données MySQL sur Coolify

### 2.1 Ajouter une ressource Database

1. Connectez-vous à votre **dashboard Coolify** (ex: `https://coolify.votreserveur.com`)
2. Allez dans votre **Projet** (ou créez-en un nouveau, ex: `ASAP`)
3. Cliquez sur **+ New** → **Database** → **MySQL**
4. Configurez :
   - **Name** : `asap-mysql`
   - **Version** : `8.0` (recommandé)
   - **Root Password** : un mot de passe fort (ex: `SuperSecretP@ss2026!`)
   - **Database** : `carpool_platform`
   - **User** : `asap_user`
   - **Password** : un mot de passe fort (ex: `AsapDbP@ss2026!`)

5. Cliquez sur **Start** pour démarrer la base de données

### 2.2 Récupérer l'URL de connexion interne

Une fois la base démarrée, Coolify vous fournit une **URL interne** de type :

```
mysql://asap_user:AsapDbP@ss2026!@asap-mysql:3306/carpool_platform
```

> ⚠️ **Important** : Utilisez le **nom du service interne** (ex: `asap-mysql`) et non `localhost`, car les conteneurs communiquent via le réseau Docker interne de Coolify.

Vous pouvez trouver cette URL dans l'onglet **Connection** de votre base de données dans Coolify.

---

## Étape 3 : Créer l'application Backend

### 3.1 Ajouter une nouvelle ressource

1. Dans votre projet Coolify, cliquez sur **+ New** → **Application**
2. Choisissez la **source Git** :
   - **GitHub** (connectez votre compte si pas déjà fait)
   - Ou **Public Repository** si le repo est public
   - Ou **GitLab / Bitbucket / Gitea**
3. Sélectionnez votre **dépôt** et la **branche** (`main` ou `production`)

### 3.2 Configurer le Build

Dans les paramètres de l'application :

| Paramètre | Valeur |
|---|---|
| **Build Pack** | `Dockerfile` |
| **Dockerfile Location** | `./Dockerfile` (par défaut) |
| **Port exposé** | `3000` |
| **Base Directory** | `/` (racine du repo) |

> Coolify détectera automatiquement le `Dockerfile` à la racine du projet.

### 3.3 Configurer le Health Check (optionnel mais recommandé)

Si vous avez un endpoint de santé, configurez :
- **Health Check Path** : `/` ou un endpoint dédié comme `/health`
- **Health Check Interval** : `30s`

---

## Étape 4 : Configurer les variables d'environnement

C'est l'étape **la plus importante**. Dans l'onglet **Environment Variables** de votre application sur Coolify, ajoutez les variables suivantes :

### Variables obligatoires

```env
# App
NODE_ENV=production
PORT=3000
APP_URL=https://app.asapjoin.com
API_URL=https://api.asapjoin.com
CORS_ORIGINS=https://app.asapjoin.com,https://admin.asapjoin.com

# Database (URL interne Coolify)
DATABASE_URL=mysql://asap_user:AsapDbP@ss2026!@asap-mysql:3306/carpool_platform

# Auth (CHANGEZ CES VALEURS avec des secrets forts !)
JWT_ACCESS_SECRET=votre-secret-access-tres-long-et-aleatoire-ici
JWT_REFRESH_SECRET=votre-secret-refresh-tres-long-et-aleatoire-ici
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Stripe
STRIPE_SECRET_KEY=sk_live_... (ou sk_test_... pour le staging)
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CURRENCY=CAD

# Email
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=no-reply@asapjoin.com

# Payout/Policies
HOLD_DELAY_DAYS=7
MIN_PAYOUT_AMOUNT=10.00
PAYOUT_FREQUENCY_DAYS=7
```

### Générer des secrets JWT sécurisés

Vous pouvez générer des secrets forts avec cette commande :

```bash
# Sur Linux/Mac
openssl rand -base64 64

# Ou avec Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

> 💡 **Astuce Coolify** : Vous pouvez marquer les variables sensibles comme **Secret** dans Coolify pour qu'elles ne soient pas visibles en clair dans l'interface.

---

## Étape 5 : Configurer le domaine et HTTPS

### 5.1 Configurer le domaine dans Coolify

1. Dans les paramètres de votre application, onglet **General**
2. Dans le champ **Domains**, ajoutez :
   ```
   https://api.asapjoin.com
   ```
3. Coolify configurera automatiquement **Traefik** comme reverse proxy et générera un certificat **Let's Encrypt** SSL/TLS

### 5.2 Configurer le DNS

Chez votre registrar DNS, ajoutez un enregistrement :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `api` | `IP_DE_VOTRE_SERVEUR_COOLIFY` |

> Attendez la propagation DNS (quelques minutes à quelques heures).

---

## Étape 6 : Déployer

### 6.1 Premier déploiement

1. Cliquez sur **Deploy** dans votre application Coolify
2. Coolify va :
   - Cloner le dépôt Git
   - Builder l'image Docker (multi-stage)
   - Démarrer le conteneur
   - Exécuter `npx prisma migrate deploy` (migrations automatiques)
   - Lancer `npm run start` (le serveur Express)

### 6.2 Suivre les logs

Pendant le déploiement, surveillez les **logs de build** et les **logs d'application** dans Coolify :

- **Build Logs** : Compilation TypeScript, installation des dépendances
- **Application Logs** : Migrations Prisma, démarrage du serveur

Vous devriez voir quelque chose comme :
```
Prisma Migrate: Applied X migrations
Server running on port 3000
```

---

## Étape 7 : Vérifications post-déploiement

### 7.1 Tester l'API

```bash
# Vérifier que l'API répond
curl https://api.asapjoin.com/

# Tester la documentation Swagger (si exposée)
curl https://api.asapjoin.com/api-docs
```

### 7.2 Vérifier les logs

Dans Coolify, onglet **Logs** de votre application, vérifiez qu'il n'y a pas d'erreurs.

### 7.3 Configurer le webhook Stripe

1. Allez dans le **Dashboard Stripe** → **Developers** → **Webhooks**
2. Ajoutez un endpoint :
   - **URL** : `https://api.asapjoin.com/webhooks/stripe`
   - **Events** : Sélectionnez les événements pertinents (`payment_intent.succeeded`, `charge.refunded`, etc.)
3. Copiez le **Webhook Secret** (`whsec_...`) et mettez-le à jour dans les variables d'environnement Coolify
4. **Redéployez** l'application après avoir changé la variable

---

## Étape 8 : Seed de la base de données (optionnel)

Pour exécuter les seeds (créer un admin, données initiales), vous pouvez utiliser le **terminal** intégré de Coolify :

1. Dans votre application, cliquez sur **Terminal** (ou **Execute Command**)
2. Exécutez :

```bash
# Créer l'admin
npx tsx prisma/seed-admin.ts

# Ou le seed complet
npx tsx prisma/seed.ts
```

> **Alternative** : Vous pouvez aussi vous connecter en SSH au serveur et exécuter `docker exec` sur le conteneur.

---

## Déploiement automatique (CI/CD)

### Option 1 : Webhook Coolify (recommandé)

Coolify peut écouter les push Git et déployer automatiquement :

1. Dans les paramètres de votre application → **General**
2. Activez **Auto Deploy** (Webhook)
3. Coolify vous donne une **URL de webhook**
4. Ajoutez ce webhook dans votre dépôt Git :
   - **GitHub** : Settings → Webhooks → Add webhook
   - **GitLab** : Settings → Webhooks

Désormais, chaque `git push` sur la branche configurée déclenchera un déploiement automatique.

### Option 2 : API Coolify

Vous pouvez aussi déclencher un déploiement via l'API Coolify :

```bash
curl -X POST https://coolify.votreserveur.com/api/v1/deploy \
  -H "Authorization: Bearer VOTRE_API_TOKEN_COOLIFY" \
  -H "Content-Type: application/json" \
  -d '{"uuid": "UUID_DE_VOTRE_APPLICATION"}'
```

---

## Dépannage

### ❌ Erreur de connexion à la base de données

**Symptôme** : `Can't reach database server at 'asap-mysql:3306'`

**Solutions** :
1. Vérifiez que la base MySQL est bien **démarrée** dans Coolify
2. Vérifiez que l'application et la base sont dans le **même réseau Docker** (Coolify gère ça automatiquement si elles sont dans le même projet)
3. Vérifiez le `DATABASE_URL` — le hostname doit être le **nom du service** Coolify, pas `localhost`

### ❌ Erreur de migration Prisma

**Symptôme** : `Migration failed`

**Solutions** :
1. Vérifiez les logs pour voir quelle migration échoue
2. Connectez-vous au terminal du conteneur et exécutez manuellement :
   ```bash
   npx prisma migrate deploy
   ```
3. Si la base est vide, les migrations devraient passer sans problème

### ❌ Erreur de build TypeScript

**Symptôme** : `tsc: error`

**Solutions** :
1. Vérifiez que le build fonctionne localement : `npm run build`
2. Vérifiez les logs de build dans Coolify

### ❌ Port non accessible

**Symptôme** : `502 Bad Gateway`

**Solutions** :
1. Vérifiez que le **port exposé** dans Coolify est bien `3000`
2. Vérifiez que la variable `PORT=3000` est définie
3. Vérifiez les logs de l'application pour confirmer que le serveur démarre bien

### ❌ CORS bloqué

**Symptôme** : Erreurs CORS dans le navigateur

**Solutions** :
1. Vérifiez que `CORS_ORIGINS` contient bien l'URL de votre frontend
2. N'oubliez pas le `https://` dans les origines

### ❌ Problème OpenSSL / Prisma sur Alpine

**Symptôme** : `Error: libssl.so not found`

**Solution** : Le Dockerfile inclut déjà `apk add --no-cache openssl`. Si le problème persiste, ajoutez aussi `openssl-dev` :
```dockerfile
RUN apk add --no-cache openssl openssl-dev
```

---

## Résumé des commandes utiles

| Action | Commande |
|---|---|
| Build local | `npm run build` |
| Test local Docker | `docker build -t asap-backend .` |
| Run local Docker | `docker run -p 3000:3000 --env-file .env asap-backend` |
| Générer un secret | `openssl rand -base64 64` |
| Vérifier l'API | `curl https://api.asapjoin.com/` |

---

## Checklist de déploiement

- [ ] Code poussé sur Git
- [ ] Base de données MySQL créée sur Coolify
- [ ] Application créée sur Coolify (Build Pack: Dockerfile)
- [ ] Variables d'environnement configurées (surtout `DATABASE_URL`)
- [ ] Domaine configuré avec DNS pointant vers le serveur
- [ ] Premier déploiement lancé
- [ ] Migrations Prisma exécutées avec succès
- [ ] API accessible via HTTPS
- [ ] Webhook Stripe configuré
- [ ] Auto-deploy activé (optionnel)
- [ ] Seed admin exécuté (optionnel)
