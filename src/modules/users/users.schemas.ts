import { z } from 'zod';

export const updateProfileSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone_number: z.string().max(20).optional().nullable(),
  avatar_url: z.string().url().max(500).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  payout_email: z.string().email().max(255).optional().nullable(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
