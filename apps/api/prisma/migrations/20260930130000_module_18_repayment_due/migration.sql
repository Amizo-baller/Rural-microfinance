-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPAYMENT';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" VARCHAR(191);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");