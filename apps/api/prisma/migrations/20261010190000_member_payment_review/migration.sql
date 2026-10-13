ALTER TABLE "User" ADD COLUMN "memberId" VARCHAR(50) NOT NULL DEFAULT ('LEGACY-' || gen_random_uuid()::text);
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");
-- Existing amounts stay in their original currency; no redenomination or conversion.
ALTER TABLE "SavingsAccount" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'GHS';
ALTER TABLE "Contribution" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'GHS';
ALTER TABLE "LoanApplication" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'GHS';
ALTER TABLE "Loan" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'GHS';
ALTER TABLE "LoanRepayment" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'GHS';
ALTER TABLE "SavingsAccount" ALTER COLUMN "currency" SET DEFAULT 'SLE';
ALTER TABLE "Contribution" ALTER COLUMN "currency" SET DEFAULT 'SLE';
ALTER TABLE "LoanApplication" ALTER COLUMN "currency" SET DEFAULT 'SLE';
ALTER TABLE "Loan" ALTER COLUMN "currency" SET DEFAULT 'SLE';
ALTER TABLE "LoanRepayment" ALTER COLUMN "currency" SET DEFAULT 'SLE';
ALTER TABLE "SavingsAccount" DROP CONSTRAINT "SavingsAccount_groupMemberId_key";
CREATE UNIQUE INDEX "SavingsAccount_groupMemberId_currency_key" ON "SavingsAccount"("groupMemberId", "currency");
CREATE TABLE "PaymentSubmission" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "groupId" UUID NOT NULL, "loanId" UUID,
  "kind" VARCHAR(20) NOT NULL CHECK ("kind" IN ('CONTRIBUTION','REPAYMENT')),
  "amount" DECIMAL(18,2) NOT NULL CHECK ("amount" > 0), "currency" VARCHAR(3) NOT NULL DEFAULT 'SLE',
  "weekStart" DATE, "reference" VARCHAR(100) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK ("status" IN ('AWAITING_PAYMENT','PAID','SUBMITTED','CONFIRMED','REJECTED')),
  "gateway" VARCHAR(20), "gatewayId" VARCHAR(100), "checkoutUrl" TEXT, "gatewayPaidAt" TIMESTAMP(3),
  "receipt" TEXT, "submittedAt" TIMESTAMP(3), "reviewedAt" TIMESTAMP(3), "reviewerId" UUID,
  "reviewNotes" VARCHAR(1000), "transactionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentSubmission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentSubmission_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentSubmission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentSubmission_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentSubmission_reference_key" ON "PaymentSubmission"("reference");
CREATE UNIQUE INDEX "PaymentSubmission_transactionId_key" ON "PaymentSubmission"("transactionId");
CREATE UNIQUE INDEX "PaymentSubmission_gateway_gatewayId_key" ON "PaymentSubmission"("gateway","gatewayId");
CREATE INDEX "PaymentSubmission_groupId_status_createdAt_idx" ON "PaymentSubmission"("groupId","status","createdAt");
CREATE INDEX "PaymentSubmission_userId_createdAt_idx" ON "PaymentSubmission"("userId","createdAt");
CREATE TABLE "ProofDelivery" (
  "id" UUID NOT NULL, "reference" VARCHAR(100) NOT NULL, "recordHash" VARCHAR(66) NOT NULL,
  "transactionType" VARCHAR(40) NOT NULL, "payload" JSONB NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "transactionHash" VARCHAR(66), "confirmedAt" TIMESTAMP(3), "lastError" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProofDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProofDelivery_reference_key" ON "ProofDelivery"("reference");
CREATE INDEX "ProofDelivery_status_nextAttemptAt_idx" ON "ProofDelivery"("status","nextAttemptAt");
