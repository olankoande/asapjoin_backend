import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { CreateVehicleInput, UpdateVehicleInput } from './vehicles.schemas';

export async function listVehicles(userId: string) {
  return prisma.vehicles.findMany({
    where: { user_id: BigInt(userId), deleted_at: null },
    orderBy: { created_at: 'desc' },
  });
}

export async function getVehicle(userId: string, vehicleId: string) {
  const vehicle = await prisma.vehicles.findFirst({
    where: { id: BigInt(vehicleId), user_id: BigInt(userId), deleted_at: null },
  });
  if (!vehicle) throw Errors.notFound('Vehicle');
  return vehicle;
}

export async function createVehicle(userId: string, input: CreateVehicleInput) {
  return prisma.vehicles.create({
    data: {
      user_id: BigInt(userId),
      make: input.make,
      model: input.model,
      year: input.year ?? null,
      color: input.color ?? null,
      plate: input.plate ?? null,
      seats_count: input.seats_count ?? 4,
      has_ac: input.has_ac ?? false,
      notes: input.notes ?? null,
    },
  });
}

export async function updateVehicle(userId: string, vehicleId: string, input: UpdateVehicleInput) {
  const vehicle = await prisma.vehicles.findFirst({
    where: { id: BigInt(vehicleId), deleted_at: null },
  });
  if (!vehicle) throw Errors.notFound('Vehicle');
  if (vehicle.user_id !== BigInt(userId)) throw Errors.forbidden('You do not own this vehicle');

  return prisma.vehicles.update({
    where: { id: BigInt(vehicleId) },
    data: {
      ...(input.make !== undefined && { make: input.make }),
      ...(input.model !== undefined && { model: input.model }),
      ...(input.year !== undefined && { year: input.year }),
      ...(input.color !== undefined && { color: input.color }),
      ...(input.plate !== undefined && { plate: input.plate }),
      ...(input.seats_count !== undefined && { seats_count: input.seats_count }),
      ...(input.has_ac !== undefined && { has_ac: input.has_ac }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
  });
}

export async function deleteVehicle(userId: string, vehicleId: string) {
  const vehicle = await prisma.vehicles.findFirst({
    where: { id: BigInt(vehicleId), deleted_at: null },
  });
  if (!vehicle) throw Errors.notFound('Vehicle');
  if (vehicle.user_id !== BigInt(userId)) throw Errors.forbidden('You do not own this vehicle');

  // Soft delete
  await prisma.vehicles.update({
    where: { id: BigInt(vehicleId) },
    data: { deleted_at: new Date() },
  });
  return { message: 'Vehicle deleted' };
}
