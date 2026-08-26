import { z } from 'zod';

// Normalise a Nigerian mobile: accept 0803..., 234803..., +234803...  → +234803...
export const ngPhone = z
  .string()
  .transform((v) => v.replace(/[^\d+]/g, ''))
  .refine((v) => /^\+?\d{10,14}$/.test(v), 'Invalid phone number')
  .transform((v) => {
    let digits = v.replace(/^\+/, '');
    if (digits.startsWith('0')) digits = '234' + digits.slice(1);
    if (!digits.startsWith('234')) digits = '234' + digits;
    return `+${digits}`;
  });

export const requestOtpDto = z.object({
  phone: ngPhone,
  purpose: z.enum(['login', 'verify_phone']).default('login'),
});

export const verifyOtpDto = z.object({
  phone: ngPhone,
  code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export const setRoleDto = z.object({
  role: z.enum(['rider', 'driver']),
  fullName: z.string().min(2).max(200),
});

export const verifyNinDto = z.object({
  nin: z.string().regex(/^\d{11}$/, 'NIN must be 11 digits'),
  dateOfBirth: z.string().optional(),
});

export const setSosPinDto = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
});

export const refreshDto = z.object({
  refreshToken: z.string().min(20),
});

export type RequestOtpDto = z.infer<typeof requestOtpDto>;
export type VerifyOtpDto = z.infer<typeof verifyOtpDto>;
export type SetRoleDto = z.infer<typeof setRoleDto>;
export type VerifyNinDto = z.infer<typeof verifyNinDto>;
export type SetSosPinDto = z.infer<typeof setSosPinDto>;
export type RefreshDto = z.infer<typeof refreshDto>;
