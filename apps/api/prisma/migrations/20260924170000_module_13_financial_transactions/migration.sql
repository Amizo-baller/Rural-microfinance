-- Module 13: centralized transaction metadata and correction-safe fields.
ALTER TYPE "TransactionType" ADD VALUE 'SAVINGS';
ALTER TYPE "TransactionType" ADD VALUE 'OTHER';
ALTER TABLE "financial_transactions" ADD COLUMN "groupId" UUID;
ALTER TABLE "financial_transactions" ADD COLUMN "description" TEXT;
ALTER TABLE "financial_transactions" ADD COLUMN "blockchainStatus" "BlockchainTransactionStatus";
ALTER TABLE "financial_transactions" ADD COLUMN "blockchainHash" VARCHAR(66);
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "financial_transactions_blockchainHash_key" ON "financial_transactions"("blockchainHash");
CREATE INDEX "financial_transactions_groupId_occurredAt_idx" ON "financial_transactions"("groupId", "occurredAt");