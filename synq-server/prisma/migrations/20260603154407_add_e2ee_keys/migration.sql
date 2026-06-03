-- AlterTable
ALTER TABLE "User" ADD COLUMN     "encryptedPrivateKey" TEXT,
ADD COLUMN     "keySalt" TEXT,
ADD COLUMN     "publicKey" TEXT;
