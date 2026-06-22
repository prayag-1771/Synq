import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(30),
    email: z.string().email(),
    password: z.string().min(6).max(100),
    publicKey: z.string().min(1, "Public key is required"),
    encryptedPrivateKey: z.string().min(1, "Encrypted private key is required"),
    keySalt: z.string().min(1, "Key salt is required"),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    emailOrUsername: z.string().min(3).max(255),
    password: z.string().min(1),
  }),
});
