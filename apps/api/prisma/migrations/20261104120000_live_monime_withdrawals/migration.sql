UPDATE "SavingsAccount" sa
SET "balance" = sa."balance" - reserved."amount"
FROM (
  SELECT "savingsAccountId", SUM("amount") AS amount
  FROM "WithdrawalRequest"
  WHERE "status" = 'PENDING'
  GROUP BY "savingsAccountId"
) reserved
WHERE sa."id" = reserved."savingsAccountId";
ALTER TABLE "SavingsAccount" ADD COLUMN "withdrawalFeeDue" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "WithdrawalRequest"
  ADD COLUMN "payoutDestination" JSONB,
  ADD COLUMN "payoutFeePaid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payoutIdempotencyKey" VARCHAR(64),
  ADD COLUMN "payoutId" VARCHAR(100),
  ADD COLUMN "payoutReference" VARCHAR(150),
  ADD COLUMN "payoutReceipt" JSONB,
  ADD COLUMN "payoutFees" DECIMAL(18,2),
  ADD COLUMN "payoutAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payoutNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "payoutLastError" VARCHAR(500);
CREATE UNIQUE INDEX "WithdrawalRequest_payoutIdempotencyKey_key" ON "WithdrawalRequest"("payoutIdempotencyKey");
CREATE INDEX "WithdrawalRequest_status_payoutNextAttemptAt_idx" ON "WithdrawalRequest"("status", "payoutNextAttemptAt");
