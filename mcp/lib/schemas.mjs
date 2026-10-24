import { z } from 'zod';
import { isAddress } from 'viem';

export const addressSchema = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), { message: 'invalid Ethereum address' })
  .transform((v) => v.toLowerCase());

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, { message: 'salt must be 32-byte hex (0x + 64 hex chars)' });

export const optionalBytes32Schema = bytes32Schema.optional();
