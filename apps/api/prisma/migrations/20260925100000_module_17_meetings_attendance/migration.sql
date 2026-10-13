-- Module 17: meeting organizer and description fields.
ALTER TABLE "Meeting" ADD COLUMN "organizerId" UUID;
ALTER TABLE "Meeting" ADD COLUMN "description" TEXT;
UPDATE "Meeting" SET "organizerId" = "CommunityGroup"."managerId" FROM "CommunityGroup" WHERE "Meeting"."groupId" = "CommunityGroup"."id" AND "CommunityGroup"."managerId" IS NOT NULL;
DELETE FROM "Meeting" WHERE "organizerId" IS NULL;
ALTER TABLE "Meeting" ALTER COLUMN "organizerId" SET NOT NULL;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Meeting_organizerId_idx" ON "Meeting"("organizerId");