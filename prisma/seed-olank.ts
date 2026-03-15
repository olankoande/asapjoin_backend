/**
 * Script de seed pour l'utilisateur olank@gmail.com
 * Crée un profil complet avec véhicule, trajets, réservations, paiements, etc.
 *
 * Usage :
 *   cd backend
 *   npx tsx prisma/seed-olank.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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

async function main() {
  console.log('🚀 Création du profil complet pour olank@gmail.com...');

  // Vérifier si l'utilisateur existe déjà
  const existing = await prisma.users.findUnique({ where: { email: 'olank@gmail.com' } });
  if (existing) {
    console.log('⚠️  L\'utilisateur olank@gmail.com existe déjà (id=' + existing.id + '). Suppression des données liées...');
    // Supprimer les données liées dans l'ordre
    await prisma.messages.deleteMany({ where: { sender_id: existing.id } });
    await prisma.reviews.deleteMany({ where: { OR: [{ author_id: existing.id }, { target_user_id: existing.id }] } });
    await prisma.refunds.deleteMany({ where: { payment: { OR: [{ payer_id: existing.id }, { payee_id: existing.id }] } } });
    await prisma.payments.deleteMany({ where: { OR: [{ payer_id: existing.id }, { payee_id: existing.id }] } });
    await prisma.deliveries.deleteMany({ where: { sender_id: existing.id } });
    await prisma.bookings.deleteMany({ where: { passenger_id: existing.id } });
    // Supprimer les bookings/deliveries liés aux trips de cet utilisateur
    const userTrips = await prisma.trips.findMany({ where: { driver_id: existing.id }, select: { id: true } });
    const tripIds = userTrips.map(t => t.id);
    if (tripIds.length > 0) {
      await prisma.messages.deleteMany({ where: { conversation: { OR: [{ booking: { trip_id: { in: tripIds } } }, { delivery: { trip_id: { in: tripIds } } }] } } });
      await prisma.conversations.deleteMany({ where: { OR: [{ booking: { trip_id: { in: tripIds } } }, { delivery: { trip_id: { in: tripIds } } }] } });
      await prisma.reviews.deleteMany({ where: { OR: [{ booking: { trip_id: { in: tripIds } } }, { delivery: { trip_id: { in: tripIds } } }] } });
      await prisma.payments.deleteMany({ where: { OR: [{ booking: { trip_id: { in: tripIds } } }, { delivery: { trip_id: { in: tripIds } } }] } });
      await prisma.deliveries.deleteMany({ where: { trip_id: { in: tripIds } } });
      await prisma.bookings.deleteMany({ where: { trip_id: { in: tripIds } } });
      await prisma.trip_stops.deleteMany({ where: { trip_id: { in: tripIds } } });
      await prisma.trips.deleteMany({ where: { driver_id: existing.id } });
    }
    await prisma.wallet_transactions.deleteMany({ where: { wallet: { user_id: existing.id } } });
    await prisma.wallets.deleteMany({ where: { user_id: existing.id } });
    await prisma.payouts.deleteMany({ where: { user_id: existing.id } });
    await prisma.vehicles.deleteMany({ where: { user_id: existing.id } });
    await prisma.reports.deleteMany({ where: { reporter_id: existing.id } });
    await prisma.admin_audit_logs.deleteMany({ where: { admin_id: existing.id } });
    await prisma.users.delete({ where: { id: existing.id } });
    console.log('   ✅ Ancien profil supprimé.');
  }

  const passwordHash = await bcrypt.hash('Admin123!', 12);

  // ─── 1. UTILISATEUR ─────────────────────────────────────────────────────

  const olank = await prisma.users.create({
    data: {
      email: 'olank@gmail.com',
      password_hash: passwordHash,
      first_name: 'Olivier',
      last_name: 'Lankoandé',
      display_name: 'Olank',
      phone_number: '+1-514-555-7777',
      payout_email: 'olank@gmail.com',
      bio: 'Passionné de covoiturage et de voyages à travers le Canada. Conducteur et passager régulier sur la route Montréal-Ottawa. 🍁',
      email_verified: true,
      role: 'user',
      status: 'active',
      default_mode: 'driver',
    },
  });

  console.log(`   ✅ Utilisateur créé (id=${olank.id})`);

  // ─── 2. VÉHICULES ──────────────────────────────────────────────────────

  const vehicleMain = await prisma.vehicles.create({
    data: {
      user_id: olank.id,
      make: 'Tesla',
      model: 'Model 3',
      year: 2024,
      color: 'Noir',
      plate: 'QC OLNK',
      seats_count: 4,
      has_ac: true,
      notes: 'Électrique, silencieuse, chargeur USB-C pour tous. Autopilot activé.',
    },
  });

  const vehicleSecond = await prisma.vehicles.create({
    data: {
      user_id: olank.id,
      make: 'Toyota',
      model: 'Highlander',
      year: 2022,
      color: 'Gris métallique',
      plate: 'QC 4521',
      seats_count: 6,
      has_ac: true,
      notes: 'SUV familial, idéal pour les groupes et les colis volumineux. AWD.',
    },
  });

  console.log('   ✅ 2 véhicules créés');

  // ─── 3. Récupérer des utilisateurs existants pour les interactions ──────

  // Trouver quelques utilisateurs existants pour créer des interactions
  const otherUsers = await prisma.users.findMany({
    where: {
      id: { not: olank.id },
      role: 'user',
      status: 'active',
      is_banned: false,
    },
    take: 6,
    orderBy: { id: 'asc' },
  });

  if (otherUsers.length < 3) {
    console.log('⚠️  Pas assez d\'utilisateurs existants. Lancez d\'abord npm run seed.');
    return;
  }

  const [user1, user2, user3, user4, user5, user6] = otherUsers;

  // ─── 4. TRAJETS EN TANT QUE CONDUCTEUR ─────────────────────────────────

  // Trajet futur 1 : Montréal → Ottawa (publié)
  const tripFuture1 = await prisma.trips.create({
    data: {
      driver_id: olank.id,
      vehicle_id: vehicleMain.id,
      from_city: 'Montréal',
      to_city: 'Ottawa',
      from_address: '1001 Boulevard de Maisonneuve O, Montréal, QC H3A 3C8',
      to_address: '150 Elgin St, Ottawa, ON K2P 1L4',
      departure_at: futureDate(2, 7),
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
      rules_json: JSON.stringify(['Voiture électrique — pas de fumée', 'Musique lo-fi pendant le trajet 🎵', 'Ponctualité SVP']),
    },
  });

  // Trajet futur 2 : Montréal → Québec (publié, gros véhicule)
  const tripFuture2 = await prisma.trips.create({
    data: {
      driver_id: olank.id,
      vehicle_id: vehicleSecond.id,
      from_city: 'Montréal',
      to_city: 'Québec',
      from_address: '800 Rue de la Gauchetière O, Montréal, QC H5A 1K6',
      to_address: '900 Boulevard René-Lévesque E, Québec, QC G1R 2B5',
      departure_at: futureDate(6, 9),
      price_per_seat: 30.00,
      currency: 'CAD',
      seats_total: 5,
      seats_available: 3,
      booking_mode: 'manual',
      status: 'published',
      accepts_parcels: true,
      parcel_max_size: 'L',
      parcel_max_weight_kg: 25.00,
      parcel_price_mode: 'by_size',
      parcel_base_price: 10.00,
      rules_json: JSON.stringify(['Animaux acceptés 🐕', 'Gros coffre disponible pour bagages']),
    },
  });

  // Trajet futur 3 : Ottawa → Toronto (publié)
  const tripFuture3 = await prisma.trips.create({
    data: {
      driver_id: olank.id,
      vehicle_id: vehicleMain.id,
      from_city: 'Ottawa',
      to_city: 'Toronto',
      from_address: '111 Wellington St, Ottawa, ON K1A 0A6',
      to_address: '1 Dundas St W, Toronto, ON M5G 1Z3',
      departure_at: futureDate(9, 6),
      price_per_seat: 45.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 3,
      booking_mode: 'instant',
      status: 'published',
      accepts_parcels: false,
      rules_json: JSON.stringify(['Départ tôt le matin', 'Arrêt café à Kingston']),
    },
  });

  // Trajet futur 4 : Montréal → Sherbrooke (brouillon)
  const tripDraft = await prisma.trips.create({
    data: {
      driver_id: olank.id,
      vehicle_id: vehicleMain.id,
      from_city: 'Montréal',
      to_city: 'Sherbrooke',
      from_address: '1001 Boulevard de Maisonneuve O, Montréal, QC H3A 3C8',
      to_address: '191 Rue du Palais, Sherbrooke, QC J1H 5C5',
      departure_at: futureDate(14, 10),
      price_per_seat: 25.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 3,
      booking_mode: 'instant',
      status: 'draft',
      accepts_parcels: false,
    },
  });

  // Trajet passé 1 : Montréal → Ottawa (complété)
  const tripPast1 = await prisma.trips.create({
    data: {
      driver_id: olank.id,
      vehicle_id: vehicleMain.id,
      from_city: 'Montréal',
      to_city: 'Ottawa',
      from_address: '1001 Boulevard de Maisonneuve O, Montréal, QC H3A 3C8',
      to_address: '150 Elgin St, Ottawa, ON K2P 1L4',
      departure_at: pastDate(7, 8),
      price_per_seat: 35.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 0,
      booking_mode: 'instant',
      status: 'completed',
      accepts_parcels: true,
      parcel_max_size: 'S',
      parcel_max_weight_kg: 5.00,
      parcel_price_mode: 'fixed',
      parcel_base_price: 12.00,
    },
  });

  // Trajet passé 2 : Québec → Montréal (complété)
  const tripPast2 = await prisma.trips.create({
    data: {
      driver_id: olank.id,
      vehicle_id: vehicleSecond.id,
      from_city: 'Québec',
      to_city: 'Montréal',
      from_address: '2700 Boulevard Laurier, Québec, QC G1V 2L8',
      to_address: '1500 Rue Peel, Montréal, QC H3A 1S9',
      departure_at: pastDate(14, 15),
      price_per_seat: 30.00,
      currency: 'CAD',
      seats_total: 5,
      seats_available: 1,
      booking_mode: 'manual',
      status: 'completed',
      accepts_parcels: true,
      parcel_max_size: 'M',
      parcel_max_weight_kg: 10.00,
      parcel_price_mode: 'fixed',
      parcel_base_price: 10.00,
    },
  });

  // Trajet passé 3 : Montréal → Toronto (annulé)
  const tripCancelled = await prisma.trips.create({
    data: {
      driver_id: olank.id,
      vehicle_id: vehicleMain.id,
      from_city: 'Montréal',
      to_city: 'Toronto',
      from_address: '1001 Boulevard de Maisonneuve O, Montréal, QC H3A 3C8',
      to_address: '100 Queen St W, Toronto, ON M5H 2N2',
      departure_at: pastDate(3, 6),
      price_per_seat: 55.00,
      currency: 'CAD',
      seats_total: 3,
      seats_available: 3,
      booking_mode: 'instant',
      status: 'cancelled',
      accepts_parcels: false,
    },
  });

  console.log('   ✅ 7 trajets créés (3 futurs publiés, 1 brouillon, 2 complétés, 1 annulé)');

  // ─── 5. ARRÊTS INTERMÉDIAIRES ──────────────────────────────────────────

  // Arrêts pour tripFuture1 (Montréal → Ottawa)
  await prisma.trip_stops.create({
    data: { trip_id: tripFuture1.id, stop_order: 1, city: 'Hawkesbury', address: '600 Rue McGill, Hawkesbury, ON K6A 1R5', eta_at: futureDate(2, 9) },
  });

  // Arrêts pour tripFuture2 (Montréal → Québec)
  await prisma.trip_stops.createMany({
    data: [
      { trip_id: tripFuture2.id, stop_order: 1, city: 'Trois-Rivières', address: '1325 Place de l\'Hôtel-de-Ville, Trois-Rivières, QC G9A 5L3', eta_at: futureDate(6, 11) },
      { trip_id: tripFuture2.id, stop_order: 2, city: 'Drummondville', address: '415 Rue Lindsay, Drummondville, QC J2B 1G4', eta_at: futureDate(6, 10) },
    ],
  });

  // Arrêts pour tripFuture3 (Ottawa → Toronto)
  await prisma.trip_stops.create({
    data: { trip_id: tripFuture3.id, stop_order: 1, city: 'Kingston', address: '216 Ontario St, Kingston, ON K7L 2Z3', eta_at: futureDate(9, 9) },
  });

  // Arrêts pour tripPast1 (Montréal → Ottawa passé)
  await prisma.trip_stops.create({
    data: { trip_id: tripPast1.id, stop_order: 1, city: 'Hawkesbury', address: '600 Rue McGill, Hawkesbury, ON K6A 1R5', eta_at: pastDate(7, 10) },
  });

  console.log('   ✅ 5 arrêts intermédiaires créés');

  // ─── 6. RÉSERVATIONS SUR LES TRAJETS D'OLANK (en tant que conducteur) ──

  // Réservations sur tripFuture1
  const bookingOnTrip1_a = await prisma.bookings.create({
    data: { trip_id: tripFuture1.id, passenger_id: user1.id, seats_requested: 1, status: 'paid', amount_total: 35.00, currency: 'CAD' },
  });
  const bookingOnTrip1_b = await prisma.bookings.create({
    data: { trip_id: tripFuture1.id, passenger_id: user2.id, seats_requested: 1, status: 'paid', amount_total: 35.00, currency: 'CAD' },
  });

  // Réservations sur tripFuture2
  const bookingOnTrip2_a = await prisma.bookings.create({
    data: { trip_id: tripFuture2.id, passenger_id: user3.id, seats_requested: 2, status: 'pending', amount_total: 60.00, currency: 'CAD' },
  });

  // Réservations sur tripPast1 (complété)
  const bookingOnPast1_a = await prisma.bookings.create({
    data: { trip_id: tripPast1.id, passenger_id: user1.id, seats_requested: 1, status: 'completed', amount_total: 35.00, currency: 'CAD' },
  });
  const bookingOnPast1_b = await prisma.bookings.create({
    data: { trip_id: tripPast1.id, passenger_id: user2.id, seats_requested: 1, status: 'completed', amount_total: 35.00, currency: 'CAD' },
  });
  const bookingOnPast1_c = await prisma.bookings.create({
    data: { trip_id: tripPast1.id, passenger_id: user3.id, seats_requested: 1, status: 'completed', amount_total: 35.00, currency: 'CAD' },
  });

  // Réservations sur tripPast2 (complété)
  const bookingOnPast2_a = await prisma.bookings.create({
    data: { trip_id: tripPast2.id, passenger_id: user4 ? user4.id : user1.id, seats_requested: 2, status: 'completed', amount_total: 60.00, currency: 'CAD' },
  });
  const bookingOnPast2_b = await prisma.bookings.create({
    data: { trip_id: tripPast2.id, passenger_id: user5 ? user5.id : user2.id, seats_requested: 2, status: 'completed', amount_total: 60.00, currency: 'CAD' },
  });

  console.log('   ✅ 8 réservations sur les trajets d\'Olank');

  // ─── 7. RÉSERVATIONS D'OLANK EN TANT QUE PASSAGER ──────────────────────

  // Trouver des trajets existants d'autres conducteurs
  const otherTrips = await prisma.trips.findMany({
    where: {
      driver_id: { not: olank.id },
      status: { in: ['published', 'completed'] },
    },
    take: 3,
    orderBy: { id: 'asc' },
  });

  const olankBookings: any[] = [];
  if (otherTrips.length >= 1) {
    const ob1 = await prisma.bookings.create({
      data: { trip_id: otherTrips[0].id, passenger_id: olank.id, seats_requested: 1, status: otherTrips[0].status === 'completed' ? 'completed' : 'paid', amount_total: Number(otherTrips[0].price_per_seat), currency: 'CAD' },
    });
    olankBookings.push(ob1);
  }
  if (otherTrips.length >= 2) {
    const ob2 = await prisma.bookings.create({
      data: { trip_id: otherTrips[1].id, passenger_id: olank.id, seats_requested: 1, status: otherTrips[1].status === 'completed' ? 'completed' : 'paid', amount_total: Number(otherTrips[1].price_per_seat), currency: 'CAD' },
    });
    olankBookings.push(ob2);
  }
  if (otherTrips.length >= 3) {
    const ob3 = await prisma.bookings.create({
      data: { trip_id: otherTrips[2].id, passenger_id: olank.id, seats_requested: 2, status: 'pending', amount_total: Number(otherTrips[2].price_per_seat) * 2, currency: 'CAD' },
    });
    olankBookings.push(ob3);
  }

  console.log(`   ✅ ${olankBookings.length} réservations d'Olank en tant que passager`);

  // ─── 8. COLIS & LIVRAISONS ─────────────────────────────────────────────

  const parcelOlank = await prisma.parcels.create({
    data: {
      size_category: 'S',
      weight_kg: 3.00,
      declared_value: 120.00,
      currency: 'CAD',
      instructions: 'Boîte de sirop d\'érable du Québec. Fragile, garder à plat.',
    },
  });

  const deliveryOnTrip1 = await prisma.deliveries.create({
    data: {
      trip_id: tripFuture1.id,
      sender_id: user5 ? user5.id : user1.id,
      parcel_id: parcelOlank.id,
      pickup_notes: 'Récupérer au 1001 Boul. de Maisonneuve, lobby.',
      dropoff_notes: 'Déposer au 150 Elgin St, réception.',
      status: 'accepted',
      delivery_code: 'DEL-OLNK-001',
      amount_total: 15.00,
      currency: 'CAD',
    },
  });

  // Livraison passée (sur tripPast1)
  const parcelPast = await prisma.parcels.create({
    data: {
      size_category: 'XS',
      weight_kg: 0.80,
      declared_value: 50.00,
      currency: 'CAD',
      instructions: 'Documents notariés. Ne pas plier.',
    },
  });

  const deliveryPast = await prisma.deliveries.create({
    data: {
      trip_id: tripPast1.id,
      sender_id: user3.id,
      parcel_id: parcelPast.id,
      pickup_notes: 'Bureau du notaire, 500 Place d\'Armes, Montréal.',
      dropoff_notes: 'Bureau 302, 150 Elgin St, Ottawa.',
      status: 'delivered',
      delivery_code: 'DEL-OLNK-002',
      amount_total: 12.00,
      currency: 'CAD',
    },
  });

  console.log('   ✅ 2 colis et 2 livraisons créés');

  // ─── 9. PAIEMENTS ──────────────────────────────────────────────────────

  // Paiements reçus (en tant que conducteur)
  const payRecv1 = await prisma.payments.create({
    data: { booking_id: bookingOnTrip1_a.id, payer_id: user1.id, payee_id: olank.id, amount: 35.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_001', stripe_charge_id: 'ch_olank_recv_001' },
  });
  const payRecv2 = await prisma.payments.create({
    data: { booking_id: bookingOnTrip1_b.id, payer_id: user2.id, payee_id: olank.id, amount: 35.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_002', stripe_charge_id: 'ch_olank_recv_002' },
  });
  const payRecv3 = await prisma.payments.create({
    data: { booking_id: bookingOnPast1_a.id, payer_id: user1.id, payee_id: olank.id, amount: 35.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_003', stripe_charge_id: 'ch_olank_recv_003' },
  });
  const payRecv4 = await prisma.payments.create({
    data: { booking_id: bookingOnPast1_b.id, payer_id: user2.id, payee_id: olank.id, amount: 35.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_004', stripe_charge_id: 'ch_olank_recv_004' },
  });
  const payRecv5 = await prisma.payments.create({
    data: { booking_id: bookingOnPast1_c.id, payer_id: user3.id, payee_id: olank.id, amount: 35.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_005', stripe_charge_id: 'ch_olank_recv_005' },
  });
  const payRecv6 = await prisma.payments.create({
    data: { booking_id: bookingOnPast2_a.id, payer_id: user4 ? user4.id : user1.id, payee_id: olank.id, amount: 60.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_006', stripe_charge_id: 'ch_olank_recv_006' },
  });
  const payRecv7 = await prisma.payments.create({
    data: { booking_id: bookingOnPast2_b.id, payer_id: user5 ? user5.id : user2.id, payee_id: olank.id, amount: 60.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_007', stripe_charge_id: 'ch_olank_recv_007' },
  });
  const payRecvDel = await prisma.payments.create({
    data: { delivery_id: deliveryPast.id, payer_id: user3.id, payee_id: olank.id, amount: 12.00, currency: 'CAD', provider: 'stripe', status: 'succeeded', stripe_payment_intent_id: 'pi_olank_recv_008', stripe_charge_id: 'ch_olank_recv_008' },
  });

  // Paiements envoyés (en tant que passager)
  for (let i = 0; i < olankBookings.length; i++) {
    const ob = olankBookings[i];
    const trip = otherTrips[i];
    if (ob.status === 'completed' || ob.status === 'paid') {
      await prisma.payments.create({
        data: {
          booking_id: ob.id,
          payer_id: olank.id,
          payee_id: trip.driver_id,
          amount: Number(ob.amount_total),
          currency: 'CAD',
          provider: 'stripe',
          status: 'succeeded',
          stripe_payment_intent_id: `pi_olank_sent_${String(i + 1).padStart(3, '0')}`,
          stripe_charge_id: `ch_olank_sent_${String(i + 1).padStart(3, '0')}`,
        },
      });
    }
  }

  console.log('   ✅ Paiements créés (reçus + envoyés)');

  // ─── 10. PORTEFEUILLE ──────────────────────────────────────────────────

  const walletOlank = await prisma.wallets.create({
    data: {
      user_id: olank.id,
      currency: 'CAD',
      pending_balance: 70.00,   // 35+35 des bookings futurs payés
      available_balance: 272.00, // 35+35+35+60+60+12 + 35 des trajets passés
    },
  });

  await prisma.wallet_transactions.createMany({
    data: [
      { wallet_id: walletOlank.id, type: 'credit', amount: 35.00, currency: 'CAD', reason_code: 'booking_payment', reference_type: 'booking', reference_id: bookingOnTrip1_a.id, balance_bucket: 'pending', created_at: new Date() },
      { wallet_id: walletOlank.id, type: 'credit', amount: 35.00, currency: 'CAD', reason_code: 'booking_payment', reference_type: 'booking', reference_id: bookingOnTrip1_b.id, balance_bucket: 'pending', created_at: new Date() },
      { wallet_id: walletOlank.id, type: 'credit', amount: 35.00, currency: 'CAD', reason_code: 'booking_payment', reference_type: 'booking', reference_id: bookingOnPast1_a.id, balance_bucket: 'available', created_at: pastDate(6) },
      { wallet_id: walletOlank.id, type: 'credit', amount: 35.00, currency: 'CAD', reason_code: 'booking_payment', reference_type: 'booking', reference_id: bookingOnPast1_b.id, balance_bucket: 'available', created_at: pastDate(6) },
      { wallet_id: walletOlank.id, type: 'credit', amount: 35.00, currency: 'CAD', reason_code: 'booking_payment', reference_type: 'booking', reference_id: bookingOnPast1_c.id, balance_bucket: 'available', created_at: pastDate(6) },
      { wallet_id: walletOlank.id, type: 'credit', amount: 60.00, currency: 'CAD', reason_code: 'booking_payment', reference_type: 'booking', reference_id: bookingOnPast2_a.id, balance_bucket: 'available', created_at: pastDate(13) },
      { wallet_id: walletOlank.id, type: 'credit', amount: 60.00, currency: 'CAD', reason_code: 'booking_payment', reference_type: 'booking', reference_id: bookingOnPast2_b.id, balance_bucket: 'available', created_at: pastDate(13) },
      { wallet_id: walletOlank.id, type: 'credit', amount: 12.00, currency: 'CAD', reason_code: 'delivery_payment', reference_type: 'delivery', reference_id: deliveryPast.id, balance_bucket: 'available', created_at: pastDate(6) },
    ],
  });

  console.log('   ✅ Portefeuille créé (70$ pending, 272$ available, 8 transactions)');

  // ─── 11. CONVERSATIONS & MESSAGES ──────────────────────────────────────

  // Conversation sur bookingOnTrip1_a
  const conv1 = await prisma.conversations.create({ data: { booking_id: bookingOnTrip1_a.id } });
  await prisma.messages.createMany({
    data: [
      { conversation_id: conv1.id, sender_id: user1.id, message_text: 'Salut Olank! Super, j\'ai réservé pour le trajet Montréal-Ottawa. On se retrouve où exactement?', created_at: pastDate(1, 14) },
      { conversation_id: conv1.id, sender_id: olank.id, message_text: 'Hey! Je serai devant le 1001 Maisonneuve, côté nord. Tesla Model 3 noire, tu ne peux pas la manquer 😄', created_at: pastDate(1, 15) },
      { conversation_id: conv1.id, sender_id: user1.id, message_text: 'Parfait! J\'aurai juste un sac à dos. À bientôt!', created_at: pastDate(1, 16) },
      { conversation_id: conv1.id, sender_id: olank.id, message_text: 'Super, à bientôt! On fera un arrêt café à Hawkesbury si ça te dit ☕', created_at: pastDate(1, 17) },
    ],
  });

  // Conversation sur bookingOnPast1_a (passé)
  const conv2 = await prisma.conversations.create({ data: { booking_id: bookingOnPast1_a.id } });
  await prisma.messages.createMany({
    data: [
      { conversation_id: conv2.id, sender_id: user1.id, message_text: 'Merci pour le trajet Olank! C\'était vraiment agréable, la Tesla est super silencieuse.', created_at: pastDate(6, 18) },
      { conversation_id: conv2.id, sender_id: olank.id, message_text: 'Merci à toi! C\'était un plaisir. N\'hésite pas à réserver à nouveau 🙌', created_at: pastDate(6, 19) },
    ],
  });

  // Conversation sur la livraison
  const conv3 = await prisma.conversations.create({ data: { delivery_id: deliveryOnTrip1.id } });
  await prisma.messages.createMany({
    data: [
      { conversation_id: conv3.id, sender_id: user5 ? user5.id : user1.id, message_text: 'Bonjour Olank, le colis de sirop d\'érable sera au lobby à 6h45. Merci!', created_at: pastDate(0, 9) },
      { conversation_id: conv3.id, sender_id: olank.id, message_text: 'Pas de souci, je le récupère en partant. C\'est bien une boîte avec un ruban rouge?', created_at: pastDate(0, 10) },
      { conversation_id: conv3.id, sender_id: user5 ? user5.id : user1.id, message_text: 'Exactement! Boîte en carton avec ruban rouge. Merci beaucoup! 🍁', created_at: pastDate(0, 11) },
    ],
  });

  console.log('   ✅ 3 conversations et 9 messages créés');

  // ─── 12. AVIS ──────────────────────────────────────────────────────────

  await prisma.reviews.createMany({
    data: [
      // Avis reçus par Olank (en tant que conducteur)
      { author_id: user1.id, target_user_id: olank.id, booking_id: bookingOnPast1_a.id, rating: 5, comment: 'Olank est un conducteur exceptionnel! Tesla impeccable, conduite douce, et super conversation. 10/10!', created_at: pastDate(6) },
      { author_id: user2.id, target_user_id: olank.id, booking_id: bookingOnPast1_b.id, rating: 5, comment: 'Meilleur covoiturage de ma vie. La voiture électrique c\'est le futur! Merci Olank.', created_at: pastDate(6) },
      { author_id: user3.id, target_user_id: olank.id, booking_id: bookingOnPast1_c.id, rating: 4, comment: 'Très bon trajet, ponctuel et agréable. L\'arrêt café à Hawkesbury était une bonne idée!', created_at: pastDate(6) },
      { author_id: user4 ? user4.id : user1.id, target_user_id: olank.id, booking_id: bookingOnPast2_a.id, rating: 5, comment: 'Olank est super sympa et son Highlander est très confortable pour les longs trajets.', created_at: pastDate(13) },
      { author_id: user5 ? user5.id : user2.id, target_user_id: olank.id, booking_id: bookingOnPast2_b.id, rating: 5, comment: 'Excellent conducteur, très professionnel. Le trajet Québec-Montréal était parfait.', created_at: pastDate(13) },
      // Avis reçus pour livraison
      { author_id: user3.id, target_user_id: olank.id, delivery_id: deliveryPast.id, rating: 5, comment: 'Documents livrés en parfait état et dans les temps. Service impeccable!', created_at: pastDate(6) },

      // Avis donnés par Olank (en tant que conducteur)
      { author_id: olank.id, target_user_id: user1.id, booking_id: bookingOnPast1_a.id, rating: 5, comment: 'Passager idéal, ponctuel et très agréable. Bienvenu à tout moment!', created_at: pastDate(6) },
      { author_id: olank.id, target_user_id: user2.id, booking_id: bookingOnPast1_b.id, rating: 5, comment: 'Super passager, conversation intéressante pendant tout le trajet!', created_at: pastDate(6) },
      { author_id: olank.id, target_user_id: user3.id, booking_id: bookingOnPast1_c.id, rating: 4, comment: 'Bon passager, un peu en retard au départ mais sinon parfait.', created_at: pastDate(6) },
    ],
  });

  // Avis d'Olank en tant que passager (si des bookings complétés existent)
  for (const ob of olankBookings) {
    if (ob.status === 'completed') {
      const trip = await prisma.trips.findUnique({ where: { id: ob.trip_id } });
      if (trip) {
        await prisma.reviews.create({
          data: {
            author_id: olank.id,
            target_user_id: trip.driver_id,
            booking_id: ob.id,
            rating: 5,
            comment: 'Excellent trajet! Conducteur ponctuel et voiture confortable. Je recommande!',
            created_at: pastDate(5),
          },
        });
      }
    }
  }

  console.log('   ✅ Avis créés (reçus et donnés)');

  // ─── RÉSUMÉ ─────────────────────────────────────────────────────────────

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('🎉 Profil olank@gmail.com créé avec succès !');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Résumé :');
  console.log('   👤 Utilisateur : Olivier Lankoandé (Olank)');
  console.log('   📧 Email : olank@gmail.com');
  console.log('   🔑 Mot de passe : Admin123!');
  console.log('   🚗 2 véhicules (Tesla Model 3, Toyota Highlander)');
  console.log('   🛣️  7 trajets conducteur (3 publiés, 1 brouillon, 2 complétés, 1 annulé)');
  console.log('   📍 5 arrêts intermédiaires');
  console.log(`   🎫 8 réservations reçues + ${olankBookings.length} réservations passager`);
  console.log('   📦 2 colis + 2 livraisons');
  console.log('   💳 Paiements reçus et envoyés');
  console.log('   👛 Portefeuille : 70$ pending + 272$ available');
  console.log('   💬 3 conversations + 9 messages');
  console.log('   ⭐ Avis reçus et donnés (note moyenne ~4.8/5)');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Erreur :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
