ALTER TYPE "AuthTokenType" ADD VALUE IF NOT EXISTS 'WALLET_LOGIN';
ALTER TYPE "AuthTokenType" ADD VALUE IF NOT EXISTS 'WALLET_LINK';
ALTER TABLE "AuthToken" ADD COLUMN "walletAddress" VARCHAR(42);
CREATE UNIQUE INDEX "User_blockchainAddress_lower_key" ON "User" (lower("blockchainAddress")) WHERE "blockchainAddress" IS NOT NULL;
