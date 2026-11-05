BEGIN;

-- Keep every user's identity, status, group ownership and financial records.
INSERT INTO "AuditLog" ("id", "userId", "action", "entityType", "entityId", "oldValues", "newValues", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", 'GROUP_MANAGER_REPLACED_BY_ADMIN', 'User', u."id",
       '{"role":"GROUP_MANAGER"}'::jsonb, '{"role":"ADMIN"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u JOIN "Role" r ON r."id" = u."roleId"
WHERE r."name" = 'GROUP_MANAGER';

-- Reuse the existing Admin role. No user account is created.
-- On installations without Admin, rename the old role in place.
UPDATE "Role" SET "name" = 'ADMIN', "description" = 'Platform administrator', "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'GROUP_MANAGER' AND NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'ADMIN');

UPDATE "User" SET "roleId" = (SELECT "id" FROM "Role" WHERE "name" = 'ADMIN'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "name" = 'GROUP_MANAGER');

COMMIT;
