-- Module 10: reviewer identity, rejection reason, and immutable decision audit entries.
ALTER TABLE "LoanApplication" ADD COLUMN "reviewerId" UUID;
ALTER TABLE "LoanApplication" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LoanApplication_reviewerId_idx" ON "LoanApplication"("reviewerId");
