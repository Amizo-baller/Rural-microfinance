-- Module 8: one savings account per member and payment-auditable contributions.
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CARD', 'OTHER');
ALTER TABLE "SavingsAccount" ADD CONSTRAINT "SavingsAccount_groupMemberId_key" UNIQUE ("groupMemberId");
ALTER TABLE "Contribution" ADD COLUMN "description" VARCHAR(500), ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH';
