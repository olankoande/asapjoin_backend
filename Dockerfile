FROM node:20-alpine AS build

WORKDIR /usr/src/app

# Installer openssl pour Prisma
RUN apk add --no-cache openssl

# Copier package.json et package-lock.json
COPY package*.json ./

# Copier le dossier prisma AVANT npm install
COPY prisma ./prisma

# Installer les dépendances
RUN npm install

# Copier le reste du projet
COPY . .

# Build éventuel
RUN npm run build

FROM node:20-alpine AS release

WORKDIR /usr/src/app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma

# Installer seulement les dépendances de production
RUN npm install --omit=dev

# Copier le build et les fichiers utiles
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /usr/src/app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000

CMD ["node", "dist/server.js"]
