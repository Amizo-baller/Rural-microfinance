-- Module 9: supporting information for submitted loan applications.
ALTER TYPE "LoanApplicationStatus" RENAME VALUE 'SUBMITTED' TO 'PENDING';
ALTER TABLE "LoanApplication" ADD COLUMN "supportingInformation" TEXT;
CREATE UNIQUE INDEX "LoanApplication_one_active_per_member_idx" ON "LoanApplication" ("groupMemberId") WHERE "status" IN ('PENDING', 'UNDER_REVIEW', 'APPROVED');