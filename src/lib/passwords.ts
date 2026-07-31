import { z } from "zod";

/**
 * Password policy: length is the primary control (NIST-style), plus a basic
 * variety requirement to block trivially guessable strings.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .refine(
    (value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value),
    "Password must contain at least one letter and one digit",
  );

export const BCRYPT_ROUNDS = 12;
