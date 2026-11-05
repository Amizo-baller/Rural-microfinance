CREATE TABLE "WithdrawalRequest" (
  "id" UUID NOT NULL,
  "savingsAccountId" UUID NOT NULL,
  "requesterId" UUID NOT NULL,
  "reviewerId" UUID,
  "amount" DECIMAL(18,2) NOT NULL,
  "reference" VARCHAR(100) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(1000) NOT NULL,
  "reviewNotes" VARCHAR(1000),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WithdrawalRequest_positive_amount" CHECK ("amount" > 0),
  CONSTRAINT "WithdrawalRequest_valid_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "WithdrawalRequest_savingsAccountId_fkey" FOREIGN KEY ("savingsAccountId") REFERENCES "SavingsAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WithdrawalRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WithdrawalRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WithdrawalRequest_reference_key" ON "WithdrawalRequest"("reference");
CREATE INDEX "WithdrawalRequest_status_createdAt_idx" ON "WithdrawalRequest"("status", "createdAt");
CREATE INDEX "WithdrawalRequest_savingsAccountId_idx" ON "WithdrawalRequest"("savingsAccountId");

CREATE TABLE "SavingsCycle" (
  "id" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "targetAmount" DECIMAL(18,2) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavingsCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavingsCycle_valid_dates" CHECK ("endDate" > "startDate"),
  CONSTRAINT "SavingsCycle_positive_target" CHECK ("targetAmount" > 0),
  CONSTRAINT "SavingsCycle_valid_status" CHECK ("status" IN ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "SavingsCycle_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SavingsCycle_groupId_status_idx" ON "SavingsCycle"("groupId", "status");
CREATE UNIQUE INDEX "SavingsCycle_one_active_per_group" ON "SavingsCycle"("groupId") WHERE "status" = 'ACTIVE';
