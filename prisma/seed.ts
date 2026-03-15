/**
 * Script de seed complet — Données fictives canadiennes
 *
 * Usage :
 *   cd backend
 *   npx tsx prisma/seed.ts
 *
 * ⚠️  Ce script supprime TOUTES les données existantes avant de re-peupler.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Helpers ────────────────────────────────────────────────────────────────

function futureDate(daysFromNow: number, hour: number = 8): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function pastDate(daysAgo: number, hour: number = 8): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🗑️  Nettoyage de la base de données...');

  // Supprimer dans l'ordre inverse des dépendances
  await prisma.admin_audit_logs.deleteMany();
  await prisma.messages.deleteMany();
  await prisma.conversations.deleteMany();
  await prisma.reviews.deleteMany();
  await prisma.reports.deleteMany();
  await prisma.refunds.deleteMany();
  await prisma.payments.deleteMany();
  await prisma.deliveries.deleteMany();
  await prisma.parcels.deleteMany();
  await prisma.bookings.deleteMany();
  await prisma.trip_stops.deleteMany();
  await prisma.trips.deleteMany();
  await prisma.vehicles.deleteMany();
  await prisma.wallet_transactions.deleteMany();
  await prisma.wallets.deleteMany();
  await prisma.payouts.deleteMany();
  await prisma.payout_batches.deleteMany();
  await prisma.cancellation_policy_rules.deleteMany();
  await prisma.cancellation_policies.deleteMany();
  await prisma.stripe_events.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.users.deleteMany();

  console.log('✅ Base nettoyée.');

  // ─── 1. USERS ───────────────────────────────────────────────────────────

  console.log('👤 Création des utilisateurs...');
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const admin = await prisma.users.create({
    data: {
      email: 'admin@asapjoin.ca',
      password_hash: passwordHash,
      first_name: 'Sophie',
      last_name: 'Tremblay',
      display_name: 'Admin Sophie',
      phone_number: '+1-514-555-0100',
      bio: 'Administratrice de la plateforme AsapJoin.',
      email_verified: true,
      role: 'admin',
      status: 'active',
      default_mode: 'passenger',
    },
  });

  const support = await prisma.users.create({
    data: {
      email: 'support@asapjoin.ca',
      password_hash: passwordHash,
      first_name: 'Marc',
      last_name: 'Gagnon',
      display_name: 'Support Marc',
      phone_number: '+1-514-555-0101',
      bio: 'Agent de support AsapJoin.',
      email_verified: true,
      role: 'support',
      status: 'active',
      default_mode: 'passenger',
    },
  });

  // Conducteurs
  const driver1 = await prisma.users.create({
    data: {
      email: 'jean.lavoie@gmail.com',
      password_hash: passwordHash,
      first_name: 'Jean',
      last_name: 'Lavoie',
      display_name: 'Jean L.',
      phone_number: '+1-514-555-0201',
      payout_email: 'jean.lavoie@gmail.com',
      bio: 'Conducteur régulier Montréal-Québec. Voiture confortable, musique chill.',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'driver',
    },
  });

  const driver2 = await prisma.users.create({
    data: {
      email: 'amelie.roy@outlook.com',
      password_hash: passwordHash,
      first_name: 'Amélie',
      last_name: 'Roy',
      display_name: 'Amélie R.',
      phone_number: '+1-418-555-0202',
      payout_email: 'amelie.roy@outlook.com',
      bio: 'Je fais le trajet Québec-Montréal chaque semaine. Animaux bienvenus! 🐕',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'driver',
    },
  });

  const driver3 = await prisma.users.create({
    data: {
      email: 'david.chen@gmail.com',
      password_hash: passwordHash,
      first_name: 'David',
      last_name: 'Chen',
      display_name: 'David C.',
      phone_number: '+1-613-555-0203',
      payout_email: 'david.chen@gmail.com',
      bio: 'Trajet Ottawa-Toronto fréquent. SUV spacieux, idéal pour les colis aussi.',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'driver',
    },
  });

  const driver4 = await prisma.users.create({
    data: {
      email: 'fatima.benali@yahoo.ca',
      password_hash: passwordHash,
      first_name: 'Fatima',
      last_name: 'Benali',
      display_name: 'Fatima B.',
      phone_number: '+1-416-555-0204',
      payout_email: 'fatima.benali@yahoo.ca',
      bio: 'Conductrice Toronto-Hamilton et GTA. Ponctuelle et sympathique.',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'driver',
    },
  });

  // Passagers
  const passenger1 = await prisma.users.create({
    data: {
      email: 'lucas.bergeron@gmail.com',
      password_hash: passwordHash,
      first_name: 'Lucas',
      last_name: 'Bergeron',
      display_name: 'Lucas B.',
      phone_number: '+1-514-555-0301',
      bio: 'Étudiant à l\'Université de Montréal. Je voyage souvent le weekend.',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'passenger',
    },
  });

  const passenger2 = await prisma.users.create({
    data: {
      email: 'emma.wilson@hotmail.com',
      password_hash: passwordHash,
      first_name: 'Emma',
      last_name: 'Wilson',
      display_name: 'Emma W.',
      phone_number: '+1-416-555-0302',
      bio: 'Professionnelle à Toronto. Covoiturage pour réduire mon empreinte carbone.',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'passenger',
    },
  });

  const passenger3 = await prisma.users.create({
    data: {
      email: 'olivier.cote@gmail.com',
      password_hash: passwordHash,
      first_name: 'Olivier',
      last_name: 'Côté',
      display_name: 'Olivier C.',
      phone_number: '+1-819-555-0303',
      bio: 'Basé à Sherbrooke, je me déplace souvent vers Montréal.',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'passenger',
    },
  });

  const passenger4 = await prisma.users.create({
    data: {
      email: 'sarah.nguyen@gmail.com',
      password_hash: passwordHash,
      first_name: 'Sarah',
      last_name: 'Nguyen',
      display_name: 'Sarah N.',
      phone_number: '+1-604-555-0304',
      bio: 'Nouvelle à Vancouver, j\'explore le Canada en covoiturage!',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'passenger',
    },
  });

  const passenger5 = await prisma.users.create({
    data: {
      email: 'maxime.pelletier@outlook.com',
      password_hash: passwordHash,
      first_name: 'Maxime',
      last_name: 'Pelletier',
      display_name: 'Maxime P.',
      phone_number: '+1-450-555-0305',
      bio: 'Expéditeur de colis fréquent entre Montréal et Québec.',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'sender',
    },
  });

  // Un utilisateur banni
  const bannedUser = await prisma.users.create({
    data: {
      email: 'banned.user@test.com',
      password_hash: passwordHash,
      first_name: 'Pierre',
      last_name: 'Dubois',
      display_name: 'Pierre D.',
      phone_number: '+1-514-555-0999',
      bio: 'Compte suspendu.',
      email_verified: true,
      is_banned: true,
      role: 'user',
      status: 'banned',
      default_mode: 'passenger',
    },
  });

  console.log(`   ✅ ${13} utilisateurs créés (1 admin, 1 support, 4 conducteurs, 5 passagers, 1 expéditeur, 1 banni)`);

  // ─── 2. VEHICLES ────────────────────────────────────────────────────────

  console.log('🚗 Création des véhicules...');

  const vehicle1 = await prisma.vehicles.create({
    data: {
      user_id: driver1.id,
      make: 'Honda',
      model: 'Civic',
      year: 2022,
      color: 'Bleu',
      plate: 'ABC 1234',
      seats_count: 4,
      has_ac: true,
      notes: 'Très propre, chargeur USB disponible.',
    },
  });

  const vehicle2 = await prisma.vehicles.create({
    data: {
      user_id: driver2.id,
      make: 'Toyota',
      model: 'RAV4',
      year: 2023,
      color: 'Blanc',
      plate: 'QC 5678',
      seats_count: 4,
      has_ac: true,
      notes: 'SUV spacieux, coffre grand pour les bagages.',
    },
  });

  const vehicle3 = await prisma.vehicles.create({
    data: {
      user_id: driver3.id,
      make: 'Hyundai',
      model: 'Tucson',
      year: 2021,
      color: 'Gris',
      plate: 'ON 9012',
      seats_count: 4,
      has_ac: true,
      notes: 'Hybride, conduite douce. Accepte les colis.',
    },
  });

  const vehicle4 = await prisma.vehicles.create({
    data: {
      user_id: driver4.id,
      make: 'Mazda',
      model: 'CX-5',
      year: 2024,
      color: 'Rouge',
      plate: 'ON 3456',
      seats_count: 4,
      has_ac: true,
      notes: 'Neuf, sièges chauffants.',
    },
  });

  // Deuxième véhicule pour driver1
  const vehicle5 = await prisma.vehicles.create({
    data: {
      user_id: driver1.id,
      make: 'Subaru',
      model: 'Outback',
      year: 2020,
      color: 'Vert forêt',
      plate: 'QC 7890',
      seats_count: 4,
      has_ac: true,
      notes: 'AWD, parfait pour l\'hiver canadien.',
    },
  });

  console.log(`   ✅ 5 véhicules créés`);

  // ─── 3. TRIPS ───────────────────────────────────────────────────────────

  console.log('🛣️  Création des trajets...');

  // Trajet 1 : Montréal → Québec (futur, publié)
  const trip1 = await prisma.trips.create({
    data: {
      driver_id: driver1.id,
      vehicle_id: vehicle1.id,
      from_city: 'Montréal',
      to_city: 'Québec',
      from_address: '1000 Rue Sherbrooke O, Montréal, QC H3A 3G4',
      to_address: '900 Boulevard René-Lévesque E, Québec, QC G1R 2B5',
      departure_at: futureDate(3, 8),
      price_per_seat: 35.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 1,
      booking_mode: 'instant',
      status: 'published',
      accepts_parcels: true,
      parcel_max_size: 'M',
      parcel_max_weight_kg: 10.00,
      parcel_price_mode: 'fixed',
      parcel_base_price: 15.00,
      rules_json: JSON.stringify(['Pas de nourriture odorante', 'Musique à volume modéré']),
    },
  });

  // Trajet 2 : Québec → Montréal (futur, publié)
  const trip2 = await prisma.trips.create({
    data: {
      driver_id: driver2.id,
      vehicle_id: vehicle2.id,
      from_city: 'Québec',
      to_city: 'Montréal',
      from_address: '2700 Boulevard Laurier, Québec, QC G1V 2L8',
      to_address: '1500 Rue Peel, Montréal, QC H3A 1S9',
      departure_at: futureDate(5, 14),
      price_per_seat: 30.00,
      currency: 'CAD',
      seats_total: 4,
      seats_available: 3,
      booking_mode: 'manual',
      status: 'published',
      accepts_parcels: true,
      parcel_max_size: 'L',
      parcel_max_weight_kg: 20.00,
      parcel_price_mode: 'by_size',
      parcel_base_price: 10.00,
      rules_json: JSON.stringify(['Animaux acceptés', 'Bagages dans le coffre SVP']),
    },
  });

  // Trajet 3 : Ottawa → Toronto (futur, publié)
  const trip3 = await prisma.trips.create({
    data: {
      driver_id: driver3.id,
      vehicle_id: vehicle3.id,
      from_city: 'Ottawa',
      to_city: 'Toronto',
      from_address: '111 Wellington St, Ottawa, ON K1A 0A6',
      to_address: '100 Queen St W, Toronto, ON M5H 2N2',
      departure_at: futureDate(2, 7),
      price_per_seat: 45.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 2,
      booking_mode: 'instant',
      status: 'published',
      accepts_parcels: true,
      parcel_max_size: 'S',
      parcel_max_weight_kg: 5.00,
      parcel_price_mode: 'fixed',
      parcel_base_price: 20.00,
      rules_json: JSON.stringify(['Pas de fumée', 'Ponctualité appréciée']),
    },
  });

  // Trajet 4 : Toronto → Hamilton (futur, publié)
  const trip4 = await prisma.trips.create({
    data: {
      driver_id: driver4.id,
      vehicle_id: vehicle4.id,
      from_city: 'Toronto',
      to_city: 'Hamilton',
      from_address: '1 Dundas St W, Toronto, ON M5G 1Z3',
      to_address: '71 Main St W, Hamilton, ON L8P 4Y5',
      departure_at: futureDate(1, 17),
      price_per_seat: 15.00,
      currency: 'CAD',
      seats_total: 4,
      seats_available: 4,
      booking_mode: 'instant',
      status: 'published',
      accepts_parcels: false,
      rules_json: JSON.stringify(['Pas de bagages volumineux']),
    },
  });

  // Trajet 5 : Montréal → Sherbrooke (futur, publié)
  const trip5 = await prisma.trips.create({
    data: {
      driver_id: driver1.id,
      vehicle_id: vehicle5.id,
      from_city: 'Montréal',
      to_city: 'Sherbrooke',
      from_address: '800 Rue de la Gauchetière O, Montréal, QC H5A 1K6',
      to_address: '191 Rue du Palais, Sherbrooke, QC J1H 5C5',
      departure_at: futureDate(7, 9),
      price_per_seat: 25.00,
      currency: 'CAD',
      seats_total: 4,
      seats_available: 3,
      booking_mode: 'manual',
      status: 'published',
      accepts_parcels: true,
      parcel_max_size: 'M',
      parcel_max_weight_kg: 15.00,
      parcel_price_mode: 'fixed',
      parcel_base_price: 12.00,
    },
  });

  // Trajet 6 : Montréal → Ottawa (futur, brouillon)
  const trip6 = await prisma.trips.create({
    data: {
      driver_id: driver1.id,
      vehicle_id: vehicle1.id,
      from_city: 'Montréal',
      to_city: 'Ottawa',
      from_address: '1000 Rue Sherbrooke O, Montréal, QC H3A 3G4',
      to_address: '111 Wellington St, Ottawa, ON K1A 0A6',
      departure_at: futureDate(10, 6),
      price_per_seat: 40.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 3,
      booking_mode: 'instant',
      status: 'draft',
      accepts_parcels: false,
    },
  });

  // Trajet 7 : Toronto → Ottawa (passé, complété)
  const trip7 = await prisma.trips.create({
    data: {
      driver_id: driver3.id,
      vehicle_id: vehicle3.id,
      from_city: 'Toronto',
      to_city: 'Ottawa',
      from_address: '100 Queen St W, Toronto, ON M5H 2N2',
      to_address: '111 Wellington St, Ottawa, ON K1A 0A6',
      departure_at: pastDate(10, 8),
      price_per_seat: 45.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 0,
      booking_mode: 'instant',
      status: 'completed',
      accepts_parcels: false,
    },
  });

  // Trajet 8 : Québec → Trois-Rivières (passé, complété)
  const trip8 = await prisma.trips.create({
    data: {
      driver_id: driver2.id,
      vehicle_id: vehicle2.id,
      from_city: 'Québec',
      to_city: 'Trois-Rivières',
      from_address: '2700 Boulevard Laurier, Québec, QC G1V 2L8',
      to_address: '1325 Place de l\'Hôtel-de-Ville, Trois-Rivières, QC G9A 5L3',
      departure_at: pastDate(5, 10),
      price_per_seat: 20.00,
      currency: 'CAD',
      seats_total: 4,
      seats_available: 1,
      booking_mode: 'manual',
      status: 'completed',
      accepts_parcels: true,
      parcel_max_size: 'S',
      parcel_max_weight_kg: 5.00,
      parcel_price_mode: 'fixed',
      parcel_base_price: 8.00,
    },
  });

  // Trajet 9 : Montréal → Québec (passé, annulé)
  const trip9 = await prisma.trips.create({
    data: {
      driver_id: driver1.id,
      vehicle_id: vehicle1.id,
      from_city: 'Montréal',
      to_city: 'Québec',
      from_address: '1000 Rue Sherbrooke O, Montréal, QC H3A 3G4',
      to_address: '900 Boulevard René-Lévesque E, Québec, QC G1R 2B5',
      departure_at: pastDate(3, 7),
      price_per_seat: 35.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 3,
      booking_mode: 'instant',
      status: 'cancelled',
      accepts_parcels: false,
    },
  });

  // Trajet 10 : Toronto → Niagara Falls (futur, publié)
  const trip10 = await prisma.trips.create({
    data: {
      driver_id: driver4.id,
      vehicle_id: vehicle4.id,
      from_city: 'Toronto',
      to_city: 'Niagara Falls',
      from_address: '1 Dundas St W, Toronto, ON M5G 1Z3',
      to_address: '6650 Niagara Pkwy, Niagara Falls, ON L2E 6X8',
      departure_at: futureDate(4, 10),
      price_per_seat: 20.00,
      currency: 'CAD',
      seats_total: 4,
      seats_available: 2,
      booking_mode: 'instant',
      status: 'published',
      accepts_parcels: false,
      rules_json: JSON.stringify(['Excursion touristique, bonne humeur obligatoire! 😄']),
    },
  });

  console.log(`   ✅ 10 trajets créés`);

  // ─── 4. TRIP STOPS ──────────────────────────────────────────────────────

  console.log('📍 Création des arrêts intermédiaires...');

  // Arrêts pour trip1 (Montréal → Québec) : Trois-Rivières
  await prisma.trip_stops.create({
    data: {
      trip_id: trip1.id,
      stop_order: 1,
      city: 'Trois-Rivières',
      address: '1325 Place de l\'Hôtel-de-Ville, Trois-Rivières, QC G9A 5L3',
      eta_at: futureDate(3, 10),
    },
  });

  // Arrêts pour trip3 (Ottawa → Toronto) : Kingston
  await prisma.trip_stops.create({
    data: {
      trip_id: trip3.id,
      stop_order: 1,
      city: 'Kingston',
      address: '216 Ontario St, Kingston, ON K7L 2Z3',
      eta_at: futureDate(2, 9),
    },
  });

  // Arrêts pour trip5 (Montréal → Sherbrooke) : Granby
  await prisma.trip_stops.create({
    data: {
      trip_id: trip5.id,
      stop_order: 1,
      city: 'Granby',
      address: '87 Rue Principale, Granby, QC J2G 2T8',
      eta_at: futureDate(7, 10),
    },
  });

  // Arrêts pour trip7 (Toronto → Ottawa passé) : Kingston, Brockville
  await prisma.trip_stops.createMany({
    data: [
      {
        trip_id: trip7.id,
        stop_order: 1,
        city: 'Kingston',
        address: '216 Ontario St, Kingston, ON K7L 2Z3',
        eta_at: pastDate(10, 11),
      },
      {
        trip_id: trip7.id,
        stop_order: 2,
        city: 'Brockville',
        address: '1 King St W, Brockville, ON K6V 3P7',
        eta_at: pastDate(10, 12),
      },
    ],
  });

  console.log(`   ✅ 5 arrêts créés`);

  // ─── 5. BOOKINGS ───────────────────────────────────────────────────────

  console.log('🎫 Création des réservations...');

  // Booking 1 : Lucas réserve trip1 (Montréal → Québec) — accepté + payé
  const booking1 = await prisma.bookings.create({
    data: {
      trip_id: trip1.id,
      passenger_id: passenger1.id,
      seats_requested: 1,
      status: 'paid',
      amount_total: 35.00,
      currency: 'CAD',
    },
  });

  // Booking 2 : Emma réserve trip1 — accepté + payé
  const booking2 = await prisma.bookings.create({
    data: {
      trip_id: trip1.id,
      passenger_id: passenger2.id,
      seats_requested: 1,
      status: 'paid',
      amount_total: 35.00,
      currency: 'CAD',
    },
  });

  // Booking 3 : Olivier réserve trip2 (Québec → Montréal) — en attente
  const booking3 = await prisma.bookings.create({
    data: {
      trip_id: trip2.id,
      passenger_id: passenger3.id,
      seats_requested: 1,
      status: 'pending',
      amount_total: 30.00,
      currency: 'CAD',
    },
  });

  // Booking 4 : Emma réserve trip3 (Ottawa → Toronto) — accepté
  const booking4 = await prisma.bookings.create({
    data: {
      trip_id: trip3.id,
      passenger_id: passenger2.id,
      seats_requested: 1,
      status: 'accepted',
      amount_total: 45.00,
      currency: 'CAD',
    },
  });

  // Booking 5 : Sarah réserve trip10 (Toronto → Niagara) — payé
  const booking5 = await prisma.bookings.create({
    data: {
      trip_id: trip10.id,
      passenger_id: passenger4.id,
      seats_requested: 2,
      status: 'paid',
      amount_total: 40.00,
      currency: 'CAD',
    },
  });

  // Booking 6 : Lucas réserve trip7 (passé, complété)
  const booking6 = await prisma.bookings.create({
    data: {
      trip_id: trip7.id,
      passenger_id: passenger1.id,
      seats_requested: 1,
      status: 'completed',
      amount_total: 45.00,
      currency: 'CAD',
    },
  });

  // Booking 7 : Emma réserve trip7 (passé, complété)
  const booking7 = await prisma.bookings.create({
    data: {
      trip_id: trip7.id,
      passenger_id: passenger2.id,
      seats_requested: 2,
      status: 'completed',
      amount_total: 90.00,
      currency: 'CAD',
    },
  });

  // Booking 8 : Olivier réserve trip8 (passé, complété)
  const booking8 = await prisma.bookings.create({
    data: {
      trip_id: trip8.id,
      passenger_id: passenger3.id,
      seats_requested: 2,
      status: 'completed',
      amount_total: 40.00,
      currency: 'CAD',
    },
  });

  // Booking 9 : Sarah réserve trip8 (passé, complété)
  const booking9 = await prisma.bookings.create({
    data: {
      trip_id: trip8.id,
      passenger_id: passenger4.id,
      seats_requested: 1,
      status: 'completed',
      amount_total: 20.00,
      currency: 'CAD',
    },
  });

  // Booking 10 : Lucas réserve trip5 — annulé
  const booking10 = await prisma.bookings.create({
    data: {
      trip_id: trip5.id,
      passenger_id: passenger1.id,
      seats_requested: 1,
      status: 'cancelled',
      cancel_reason: 'Changement de plans, je ne peux plus voyager ce jour-là.',
      amount_total: 25.00,
      currency: 'CAD',
    },
  });

  // Booking 11 : Olivier réserve trip5 — accepté
  const booking11 = await prisma.bookings.create({
    data: {
      trip_id: trip5.id,
      passenger_id: passenger3.id,
      seats_requested: 1,
      status: 'accepted',
      amount_total: 25.00,
      currency: 'CAD',
    },
  });

  console.log(`   ✅ 11 réservations créées`);

  // ─── 6. PARCELS & DELIVERIES ───────────────────────────────────────────

  console.log('📦 Création des colis et livraisons...');

  const parcel1 = await prisma.parcels.create({
    data: {
      size_category: 'M',
      weight_kg: 5.50,
      declared_value: 75.00,
      currency: 'CAD',
      instructions: 'Fragile — contient de la vaisselle artisanale du Vieux-Québec.',
    },
  });

  const parcel2 = await prisma.parcels.create({
    data: {
      size_category: 'S',
      weight_kg: 2.00,
      declared_value: 150.00,
      currency: 'CAD',
      instructions: 'Livres rares, garder au sec.',
    },
  });

  const parcel3 = await prisma.parcels.create({
    data: {
      size_category: 'XS',
      weight_kg: 0.50,
      declared_value: 30.00,
      currency: 'CAD',
      instructions: 'Enveloppe de documents importants.',
    },
  });

  const parcel4 = await prisma.parcels.create({
    data: {
      size_category: 'L',
      weight_kg: 15.00,
      declared_value: 200.00,
      currency: 'CAD',
      instructions: 'Équipement de hockey. Sac volumineux mais pas fragile.',
    },
  });

  // Delivery 1 : Maxime envoie parcel1 via trip1 (Montréal → Québec) — accepté
  const delivery1 = await prisma.deliveries.create({
    data: {
      trip_id: trip1.id,
      sender_id: passenger5.id,
      parcel_id: parcel1.id,
      pickup_notes: 'Récupérer au 1000 Rue Sherbrooke, hall d\'entrée.',
      dropoff_notes: 'Déposer chez Céramiques Québec, 45 Rue Saint-Paul.',
      status: 'accepted',
      delivery_code: 'DEL-MTL-QC-001',
      amount_total: 15.00,
      currency: 'CAD',
    },
  });

  // Delivery 2 : Maxime envoie parcel2 via trip2 (Québec → Montréal) — en attente
  const delivery2 = await prisma.deliveries.create({
    data: {
      trip_id: trip2.id,
      sender_id: passenger5.id,
      parcel_id: parcel2.id,
      pickup_notes: 'Librairie Pantoute, 1100 Rue Saint-Jean, Québec.',
      dropoff_notes: 'Librairie Le Port de tête, 262 Avenue du Mont-Royal E, Montréal.',
      status: 'pending',
      delivery_code: 'DEL-QC-MTL-002',
      amount_total: 10.00,
      currency: 'CAD',
    },
  });

  // Delivery 3 : Olivier envoie parcel3 via trip3 (Ottawa → Toronto) — payé
  const delivery3 = await prisma.deliveries.create({
    data: {
      trip_id: trip3.id,
      sender_id: passenger3.id,
      parcel_id: parcel3.id,
      pickup_notes: 'Bureau de poste, 59 Sparks St, Ottawa.',
      dropoff_notes: 'Bureau 401, 100 King St W, Toronto.',
      status: 'paid',
      delivery_code: 'DEL-OTT-TOR-003',
      amount_total: 20.00,
      currency: 'CAD',
    },
  });

  // Delivery 4 : Maxime envoie parcel4 via trip8 (passé, livré)
  const delivery4 = await prisma.deliveries.create({
    data: {
      trip_id: trip8.id,
      sender_id: passenger5.id,
      parcel_id: parcel4.id,
      pickup_notes: 'Aréna de Québec, entrée arrière.',
      dropoff_notes: 'Aréna de Trois-Rivières, vestiaire visiteurs.',
      status: 'delivered',
      delivery_code: 'DEL-QC-TR-004',
      amount_total: 8.00,
      currency: 'CAD',
    },
  });

  console.log(`   ✅ 4 colis et 4 livraisons créés`);

  // ─── 7. PAYMENTS ────────────────────────────────────────────────────────

  console.log('💳 Création des paiements...');

  // Paiement pour booking1
  const payment1 = await prisma.payments.create({
    data: {
      booking_id: booking1.id,
      payer_id: passenger1.id,
      payee_id: driver1.id,
      amount: 35.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_001',
      stripe_charge_id: 'ch_fake_seed_001',
    },
  });

  // Paiement pour booking2
  const payment2 = await prisma.payments.create({
    data: {
      booking_id: booking2.id,
      payer_id: passenger2.id,
      payee_id: driver1.id,
      amount: 35.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_002',
      stripe_charge_id: 'ch_fake_seed_002',
    },
  });

  // Paiement pour booking5
  const payment3 = await prisma.payments.create({
    data: {
      booking_id: booking5.id,
      payer_id: passenger4.id,
      payee_id: driver4.id,
      amount: 40.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_003',
      stripe_charge_id: 'ch_fake_seed_003',
    },
  });

  // Paiement pour booking6 (passé, complété)
  const payment4 = await prisma.payments.create({
    data: {
      booking_id: booking6.id,
      payer_id: passenger1.id,
      payee_id: driver3.id,
      amount: 45.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_004',
      stripe_charge_id: 'ch_fake_seed_004',
    },
  });

  // Paiement pour booking7 (passé, complété)
  const payment5 = await prisma.payments.create({
    data: {
      booking_id: booking7.id,
      payer_id: passenger2.id,
      payee_id: driver3.id,
      amount: 90.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_005',
      stripe_charge_id: 'ch_fake_seed_005',
    },
  });

  // Paiement pour booking8 (passé)
  const payment6 = await prisma.payments.create({
    data: {
      booking_id: booking8.id,
      payer_id: passenger3.id,
      payee_id: driver2.id,
      amount: 40.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_006',
      stripe_charge_id: 'ch_fake_seed_006',
    },
  });

  // Paiement pour booking9 (passé)
  const payment7 = await prisma.payments.create({
    data: {
      booking_id: booking9.id,
      payer_id: passenger4.id,
      payee_id: driver2.id,
      amount: 20.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_007',
      stripe_charge_id: 'ch_fake_seed_007',
    },
  });

  // Paiement pour delivery3
  const payment8 = await prisma.payments.create({
    data: {
      delivery_id: delivery3.id,
      payer_id: passenger3.id,
      payee_id: driver3.id,
      amount: 20.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_008',
      stripe_charge_id: 'ch_fake_seed_008',
    },
  });

  // Paiement pour delivery4 (passé)
  const payment9 = await prisma.payments.create({
    data: {
      delivery_id: delivery4.id,
      payer_id: passenger5.id,
      payee_id: driver2.id,
      amount: 8.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_fake_seed_009',
      stripe_charge_id: 'ch_fake_seed_009',
    },
  });

  // Paiement échoué (booking10 annulé)
  const payment10 = await prisma.payments.create({
    data: {
      booking_id: booking10.id,
      payer_id: passenger1.id,
      payee_id: driver1.id,
      amount: 25.00,
      currency: 'CAD',
      provider: 'stripe',
      status: 'refunded',
      stripe_payment_intent_id: 'pi_fake_seed_010',
      stripe_charge_id: 'ch_fake_seed_010',
    },
  });

  console.log(`   ✅ 10 paiements créés`);

  // ─── 8. REFUNDS ─────────────────────────────────────────────────────────

  console.log('💸 Création des remboursements...');

  await prisma.refunds.create({
    data: {
      payment_id: payment10.id,
      amount: 25.00,
      currency: 'CAD',
      status: 'succeeded',
      reason: 'Annulation par le passager — remboursement intégral.',
      stripe_refund_id: 'rf_fake_seed_001',
    },
  });

  console.log(`   ✅ 1 remboursement créé`);

  // ─── 9. WALLETS & TRANSACTIONS ─────────────────────────────────────────

  console.log('👛 Création des portefeuilles et transactions...');

  const wallet1 = await prisma.wallets.create({
    data: {
      user_id: driver1.id,
      currency: 'CAD',
      pending_balance: 70.00,
      available_balance: 0.00,
    },
  });

  const wallet2 = await prisma.wallets.create({
    data: {
      user_id: driver2.id,
      currency: 'CAD',
      pending_balance: 0.00,
      available_balance: 68.00,
    },
  });

  const wallet3 = await prisma.wallets.create({
    data: {
      user_id: driver3.id,
      currency: 'CAD',
      pending_balance: 20.00,
      available_balance: 135.00,
    },
  });

  const wallet4 = await prisma.wallets.create({
    data: {
      user_id: driver4.id,
      currency: 'CAD',
      pending_balance: 40.00,
      available_balance: 0.00,
    },
  });

  // Transactions pour wallet1 (driver1)
  await prisma.wallet_transactions.createMany({
    data: [
      {
        wallet_id: wallet1.id,
        type: 'credit',
        amount: 35.00,
        currency: 'CAD',
        reason_code: 'booking_payment',
        reference_type: 'booking',
        reference_id: booking1.id,
        balance_bucket: 'pending',
        created_at: new Date(),
      },
      {
        wallet_id: wallet1.id,
        type: 'credit',
        amount: 35.00,
        currency: 'CAD',
        reason_code: 'booking_payment',
        reference_type: 'booking',
        reference_id: booking2.id,
        balance_bucket: 'pending',
        created_at: new Date(),
      },
    ],
  });

  // Transactions pour wallet2 (driver2)
  await prisma.wallet_transactions.createMany({
    data: [
      {
        wallet_id: wallet2.id,
        type: 'credit',
        amount: 40.00,
        currency: 'CAD',
        reason_code: 'booking_payment',
        reference_type: 'booking',
        reference_id: booking8.id,
        balance_bucket: 'available',
        created_at: pastDate(4),
      },
      {
        wallet_id: wallet2.id,
        type: 'credit',
        amount: 20.00,
        currency: 'CAD',
        reason_code: 'booking_payment',
        reference_type: 'booking',
        reference_id: booking9.id,
        balance_bucket: 'available',
        created_at: pastDate(4),
      },
      {
        wallet_id: wallet2.id,
        type: 'credit',
        amount: 8.00,
        currency: 'CAD',
        reason_code: 'delivery_payment',
        reference_type: 'delivery',
        reference_id: delivery4.id,
        balance_bucket: 'available',
        created_at: pastDate(4),
      },
    ],
  });

  // Transactions pour wallet3 (driver3)
  await prisma.wallet_transactions.createMany({
    data: [
      {
        wallet_id: wallet3.id,
        type: 'credit',
        amount: 45.00,
        currency: 'CAD',
        reason_code: 'booking_payment',
        reference_type: 'booking',
        reference_id: booking6.id,
        balance_bucket: 'available',
        created_at: pastDate(9),
      },
      {
        wallet_id: wallet3.id,
        type: 'credit',
        amount: 90.00,
        currency: 'CAD',
        reason_code: 'booking_payment',
        reference_type: 'booking',
        reference_id: booking7.id,
        balance_bucket: 'available',
        created_at: pastDate(9),
      },
      {
        wallet_id: wallet3.id,
        type: 'credit',
        amount: 20.00,
        currency: 'CAD',
        reason_code: 'delivery_payment',
        reference_type: 'delivery',
        reference_id: delivery3.id,
        balance_bucket: 'pending',
        created_at: new Date(),
      },
    ],
  });

  // Transactions pour wallet4 (driver4)
  await prisma.wallet_transactions.create({
    data: {
      wallet_id: wallet4.id,
      type: 'credit',
      amount: 40.00,
      currency: 'CAD',
      reason_code: 'booking_payment',
      reference_type: 'booking',
      reference_id: booking5.id,
      balance_bucket: 'pending',
      created_at: new Date(),
    },
  });

  console.log(`   ✅ 4 portefeuilles et 9 transactions créés`);

  // ─── 10. CANCELLATION POLICIES ──────────────────────────────────────────

  console.log('📋 Création des politiques d\'annulation...');

  const bookingPolicy = await prisma.cancellation_policies.create({
    data: {
      name: 'Politique standard — Réservations',
      scope: 'booking',
      active: true,
      created_by_admin_id: admin.id,
    },
  });

  const deliveryPolicy = await prisma.cancellation_policies.create({
    data: {
      name: 'Politique standard — Livraisons',
      scope: 'delivery',
      active: true,
      created_by_admin_id: admin.id,
    },
  });

  // Règles pour la politique de réservation
  await prisma.cancellation_policy_rules.createMany({
    data: [
      {
        policy_id: bookingPolicy.id,
        min_hours_before_departure: 48,
        cancellation_fee_fixed: 0.00,
        cancellation_fee_percent: 0.00,
        refund_percent_to_payer: 100.00,
        debit_driver_percent: 0.00,
      },
      {
        policy_id: bookingPolicy.id,
        min_hours_before_departure: 24,
        cancellation_fee_fixed: 0.00,
        cancellation_fee_percent: 25.00,
        refund_percent_to_payer: 75.00,
        debit_driver_percent: 0.00,
      },
      {
        policy_id: bookingPolicy.id,
        min_hours_before_departure: 0,
        cancellation_fee_fixed: 5.00,
        cancellation_fee_percent: 50.00,
        refund_percent_to_payer: 50.00,
        debit_driver_percent: 0.00,
      },
    ],
  });

  // Règles pour la politique de livraison
  await prisma.cancellation_policy_rules.createMany({
    data: [
      {
        policy_id: deliveryPolicy.id,
        min_hours_before_departure: 24,
        cancellation_fee_fixed: 0.00,
        cancellation_fee_percent: 0.00,
        refund_percent_to_payer: 100.00,
        debit_driver_percent: 0.00,
      },
      {
        policy_id: deliveryPolicy.id,
        min_hours_before_departure: 0,
        cancellation_fee_fixed: 3.00,
        cancellation_fee_percent: 30.00,
        refund_percent_to_payer: 70.00,
        debit_driver_percent: 0.00,
      },
    ],
  });

  console.log(`   ✅ 2 politiques et 5 règles créées`);

  // ─── 11. PAYOUT BATCHES & PAYOUTS ──────────────────────────────────────

  console.log('💰 Création des lots de paiement et versements...');

  const batch1 = await prisma.payout_batches.create({
    data: {
      scheduled_for_date: pastDate(2),
      status: 'paid',
      created_by_admin_id: admin.id,
    },
  });

  const batch2 = await prisma.payout_batches.create({
    data: {
      scheduled_for_date: futureDate(5),
      status: 'draft',
      created_by_admin_id: admin.id,
    },
  });

  await prisma.payouts.create({
    data: {
      batch_id: batch1.id,
      user_id: driver3.id,
      amount: 135.00,
      currency: 'CAD',
      status: 'paid',
      payout_method: 'manual',
      destination: 'david.chen@gmail.com',
    },
  });

  await prisma.payouts.create({
    data: {
      batch_id: batch2.id,
      user_id: driver2.id,
      amount: 68.00,
      currency: 'CAD',
      status: 'queued',
      payout_method: 'manual',
      destination: 'amelie.roy@outlook.com',
    },
  });

  console.log(`   ✅ 2 lots et 2 versements créés`);

  // ─── 12. CONVERSATIONS & MESSAGES ──────────────────────────────────────

  console.log('💬 Création des conversations et messages...');

  // Conversation pour booking1
  const conv1 = await prisma.conversations.create({
    data: { booking_id: booking1.id },
  });

  await prisma.messages.createMany({
    data: [
      {
        conversation_id: conv1.id,
        sender_id: passenger1.id,
        message_text: 'Bonjour Jean! Je serai au point de rendez-vous à 7h45. Est-ce que ça vous convient?',
        created_at: pastDate(1, 18),
      },
      {
        conversation_id: conv1.id,
        sender_id: driver1.id,
        message_text: 'Salut Lucas! Parfait, je serai là à 8h pile. Cherche une Honda Civic bleue.',
        created_at: pastDate(1, 19),
      },
      {
        conversation_id: conv1.id,
        sender_id: passenger1.id,
        message_text: 'Super, merci! J\'aurai un sac à dos et une petite valise.',
        created_at: pastDate(1, 20),
      },
    ],
  });

  // Conversation pour booking4
  const conv2 = await prisma.conversations.create({
    data: { booking_id: booking4.id },
  });

  await prisma.messages.createMany({
    data: [
      {
        conversation_id: conv2.id,
        sender_id: passenger2.id,
        message_text: 'Hi David! Can we stop in Kingston for 5 minutes? I need to drop something off.',
        created_at: pastDate(0, 10),
      },
      {
        conversation_id: conv2.id,
        sender_id: driver3.id,
        message_text: 'Sure Emma, Kingston is already a planned stop. No problem at all!',
        created_at: pastDate(0, 11),
      },
    ],
  });

  // Conversation pour delivery1
  const conv3 = await prisma.conversations.create({
    data: { delivery_id: delivery1.id },
  });

  await prisma.messages.createMany({
    data: [
      {
        conversation_id: conv3.id,
        sender_id: passenger5.id,
        message_text: 'Bonjour Jean, le colis sera prêt à récupérer dès 7h30 au hall d\'entrée.',
        created_at: pastDate(0, 8),
      },
      {
        conversation_id: conv3.id,
        sender_id: driver1.id,
        message_text: 'Parfait Maxime! Je passerai le prendre avant de partir. C\'est bien un carton moyen?',
        created_at: pastDate(0, 9),
      },
      {
        conversation_id: conv3.id,
        sender_id: passenger5.id,
        message_text: 'Oui, environ 40x30x25 cm. Merci beaucoup!',
        created_at: pastDate(0, 10),
      },
    ],
  });

  console.log(`   ✅ 3 conversations et 8 messages créés`);

  // ─── 13. REVIEWS ────────────────────────────────────────────────────────

  console.log('⭐ Création des avis...');

  await prisma.reviews.createMany({
    data: [
      // Lucas note driver3 (trip7)
      {
        author_id: passenger1.id,
        target_user_id: driver3.id,
        booking_id: booking6.id,
        rating: 5,
        comment: 'Excellent trajet! David est très ponctuel et sa voiture est super confortable. Je recommande!',
        created_at: pastDate(9),
      },
      // Emma note driver3 (trip7)
      {
        author_id: passenger2.id,
        target_user_id: driver3.id,
        booking_id: booking7.id,
        rating: 4,
        comment: 'Great ride from Toronto to Ottawa. Smooth driving, nice conversation. Would ride again!',
        created_at: pastDate(9),
      },
      // Driver3 note Lucas (trip7)
      {
        author_id: driver3.id,
        target_user_id: passenger1.id,
        booking_id: booking6.id,
        rating: 5,
        comment: 'Lucas est un passager idéal. Ponctuel, poli et agréable. Bienvenu à tout moment!',
        created_at: pastDate(9),
      },
      // Driver3 note Emma (trip7)
      {
        author_id: driver3.id,
        target_user_id: passenger2.id,
        booking_id: booking7.id,
        rating: 5,
        comment: 'Emma is a wonderful passenger. Very respectful and great to chat with.',
        created_at: pastDate(9),
      },
      // Olivier note driver2 (trip8)
      {
        author_id: passenger3.id,
        target_user_id: driver2.id,
        booking_id: booking8.id,
        rating: 5,
        comment: 'Amélie est super! Son RAV4 est spacieux et elle conduit prudemment. Merci!',
        created_at: pastDate(4),
      },
      // Sarah note driver2 (trip8)
      {
        author_id: passenger4.id,
        target_user_id: driver2.id,
        booking_id: booking9.id,
        rating: 4,
        comment: 'Bon trajet, voiture propre. Un peu de retard au départ mais rien de grave.',
        created_at: pastDate(4),
      },
      // Driver2 note Olivier (trip8)
      {
        author_id: driver2.id,
        target_user_id: passenger3.id,
        booking_id: booking8.id,
        rating: 5,
        comment: 'Olivier est très sympathique et respectueux. Passager 5 étoiles!',
        created_at: pastDate(4),
      },
      // Maxime note driver2 pour delivery4
      {
        author_id: passenger5.id,
        target_user_id: driver2.id,
        delivery_id: delivery4.id,
        rating: 5,
        comment: 'Colis livré en parfait état et dans les temps. Merci Amélie!',
        created_at: pastDate(4),
      },
    ],
  });

  console.log(`   ✅ 8 avis créés`);

  // ─── 14. REPORTS ────────────────────────────────────────────────────────

  console.log('🚩 Création des signalements...');

  await prisma.reports.create({
    data: {
      reporter_id: passenger1.id,
      target_type: 'user',
      target_id: bannedUser.id,
      reason: 'Comportement inapproprié',
      details: 'Cet utilisateur a envoyé des messages offensants lors d\'un trajet précédent.',
      status: 'resolved',
      resolved_by_admin_id: admin.id,
      resolved_at: pastDate(1),
    },
  });

  await prisma.reports.create({
    data: {
      reporter_id: passenger2.id,
      target_type: 'trip',
      target_id: trip9.id,
      reason: 'Trajet suspect',
      details: 'Le prix semblait anormalement bas et le conducteur ne répondait pas aux messages.',
      status: 'open',
    },
  });

  console.log(`   ✅ 2 signalements créés`);

  // ─── 15. SETTINGS ──────────────────────────────────────────────────────

  console.log('⚙️  Création des paramètres...');

  await prisma.settings.createMany({
    data: [
      { setting_key: 'platform_fee_percent', setting_value: '10', updated_by_admin_id: admin.id },
      { setting_key: 'min_payout_amount', setting_value: '10.00', updated_by_admin_id: admin.id },
      { setting_key: 'hold_delay_days', setting_value: '7', updated_by_admin_id: admin.id },
      { setting_key: 'payout_frequency_days', setting_value: '7', updated_by_admin_id: admin.id },
      { setting_key: 'max_seats_per_booking', setting_value: '4', updated_by_admin_id: admin.id },
      { setting_key: 'default_currency', setting_value: 'CAD', updated_by_admin_id: admin.id },
      { setting_key: 'support_email', setting_value: 'support@asapjoin.ca', updated_by_admin_id: admin.id },
      { setting_key: 'maintenance_mode', setting_value: 'false', updated_by_admin_id: admin.id },
    ],
  });

  console.log(`   ✅ 8 paramètres créés`);

  // ─── 16. STRIPE EVENTS ─────────────────────────────────────────────────

  console.log('🔔 Création des événements Stripe...');

  await prisma.stripe_events.createMany({
    data: [
      {
        stripe_event_id: 'evt_fake_seed_001',
        type: 'payment_intent.succeeded',
        processed_at: pastDate(10),
        payload_json: JSON.stringify({ id: 'pi_fake_seed_004', amount: 4500, currency: 'cad' }),
      },
      {
        stripe_event_id: 'evt_fake_seed_002',
        type: 'payment_intent.succeeded',
        processed_at: pastDate(10),
        payload_json: JSON.stringify({ id: 'pi_fake_seed_005', amount: 9000, currency: 'cad' }),
      },
      {
        stripe_event_id: 'evt_fake_seed_003',
        type: 'charge.refunded',
        processed_at: pastDate(2),
        payload_json: JSON.stringify({ id: 'ch_fake_seed_010', amount_refunded: 2500, currency: 'cad' }),
      },
    ],
  });

  console.log(`   ✅ 3 événements Stripe créés`);

  // ─── 17. ADMIN AUDIT LOGS ──────────────────────────────────────────────

  console.log('📝 Création des logs d\'audit admin...');

  await prisma.admin_audit_logs.createMany({
    data: [
      {
        admin_id: admin.id,
        action: 'ban_user',
        entity_type: 'user',
        entity_id: bannedUser.id,
        details_json: JSON.stringify({ reason: 'Comportement inapproprié répété', banned_at: pastDate(1).toISOString() }),
        created_at: pastDate(1),
      },
      {
        admin_id: admin.id,
        action: 'resolve_report',
        entity_type: 'report',
        entity_id: BigInt(1),
        details_json: JSON.stringify({ resolution: 'Utilisateur banni suite au signalement' }),
        created_at: pastDate(1),
      },
      {
        admin_id: admin.id,
        action: 'create_policy',
        entity_type: 'cancellation_policy',
        entity_id: bookingPolicy.id,
        details_json: JSON.stringify({ policy_name: 'Politique standard — Réservations' }),
        created_at: pastDate(30),
      },
      {
        admin_id: admin.id,
        action: 'create_policy',
        entity_type: 'cancellation_policy',
        entity_id: deliveryPolicy.id,
        details_json: JSON.stringify({ policy_name: 'Politique standard — Livraisons' }),
        created_at: pastDate(30),
      },
      {
        admin_id: admin.id,
        action: 'approve_payout_batch',
        entity_type: 'payout_batch',
        entity_id: batch1.id,
        details_json: JSON.stringify({ total_amount: 135.00, payouts_count: 1 }),
        created_at: pastDate(2),
      },
      {
        admin_id: admin.id,
        action: 'update_setting',
        entity_type: 'setting',
        details_json: JSON.stringify({ key: 'platform_fee_percent', old_value: '15', new_value: '10' }),
        created_at: pastDate(15),
      },
    ],
  });

  console.log(`   ✅ 6 logs d'audit créés`);

  // ─── RÉSUMÉ ─────────────────────────────────────────────────────────────

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('🎉 Seed terminé avec succès !');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Résumé :');
  console.log('   • 13 utilisateurs (admin, support, 4 conducteurs, 5 passagers, 1 expéditeur, 1 banni)');
  console.log('   • 5 véhicules');
  console.log('   • 10 trajets (6 publiés, 1 brouillon, 2 complétés, 1 annulé)');
  console.log('   • 5 arrêts intermédiaires');
  console.log('   • 11 réservations (divers statuts)');
  console.log('   • 4 colis + 4 livraisons');
  console.log('   • 10 paiements + 1 remboursement');
  console.log('   • 4 portefeuilles + 9 transactions');
  console.log('   • 2 politiques d\'annulation + 5 règles');
  console.log('   • 2 lots de versement + 2 versements');
  console.log('   • 3 conversations + 8 messages');
  console.log('   • 8 avis');
  console.log('   • 2 signalements');
  console.log('   • 8 paramètres');
  console.log('   • 3 événements Stripe');
  console.log('   • 6 logs d\'audit admin');
  console.log('');
  console.log('🔑 Tous les mots de passe : Password123!');
  console.log('🔑 Admin : admin@asapjoin.ca / Password123!');
  console.log('🔑 Conducteur : jean.lavoie@gmail.com / Password123!');
  console.log('🔑 Passager : lucas.bergeron@gmail.com / Password123!');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
