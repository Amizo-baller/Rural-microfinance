-- Module 11: approved loan lifecycle and disbursement fields.
ALTER TYPE "LoanStatus" ADD VALUE 'APPROVED';
ALTER TYPE "LoanStatus" ADD VALUE 'DISBURSED';
ALTER TABLE "Loan" ADD COLUMN "loanReference" VARCHAR(100);
ALTER TABLE "Loan" ADD COLUMN "startDate" TIMESTAMP(3);
UPDATE "Loan" SET "loanReference" = 'LEGACY-' || "id" WHERE "loanReference" IS NULL;
ALTER TABLE "Loan" ALTER COLUMN "loanReference" SET NOT NULL;
CREATE UNIQUE INDEX "Loan_loanReference_key" ON "Loan"("loanReference");