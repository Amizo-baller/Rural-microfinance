ALTER TABLE "CommunityGroup"
  ADD COLUMN "weeklyContributionAmount" DECIMAL(18,2),
  ADD COLUMN "withdrawalsAllowed" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "CommunityGroup" ADD CONSTRAINT "CommunityGroup_weeklyContributionAmount_nonnegative"
  CHECK ("weeklyContributionAmount" IS NULL OR "weeklyContributionAmount" >= 0);
