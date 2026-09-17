import { z } from "zod";

export const verifyLicenseDto = z.object({
  licenseNumber: z.string().min(5).max(40),
  dateOfBirth: z.string().optional(),
});
export type VerifyLicenseDto = z.infer<typeof verifyLicenseDto>;

export const registerVehicleDto = z.object({
  type: z.enum(["car", "bus", "tricycle", "motorcycle", "minivan"]),
  brand: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z
    .number()
    .int()
    .min(1980)
    .max(new Date().getFullYear() + 1),
  color: z.string().min(1).max(40),
  plateNumber: z
    .string()
    .min(3)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s+/g, "-")),
  photos: z.array(z.string().url()).max(6).optional(),
});
export type RegisterVehicleDto = z.infer<typeof registerVehicleDto>;
