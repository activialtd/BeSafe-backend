import { createId } from '@paralleldrive/cuid2';
import { customAlphabet } from 'nanoid';

// 32-char cuid2 for primary keys — sortable-ish, URL-safe, collision-resistant
export const newId = () => createId();

// Human-friendly / short tokens
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const shortToken = (len = 12) => customAlphabet(alphabet, len)();

// Numeric OTP
const numeric = '0123456789';
export const numericCode = (len: number) => customAlphabet(numeric, len)();

// QR token for a vehicle: BSF.VEH.<id>.<12-char-hex>
export function buildQrToken(vehicleId: string): string {
  return `BSF.VEH.${vehicleId}.${shortToken(12).toLowerCase()}`;
}
