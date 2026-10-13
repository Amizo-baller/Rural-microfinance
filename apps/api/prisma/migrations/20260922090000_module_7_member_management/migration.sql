-- Module 7: each person has one community-group membership. This makes the
-- single-group business rule enforceable even if requests arrive concurrently.
CREATE UNIQUE INDEX "GroupMember_userId_key" ON "GroupMember"("userId");
