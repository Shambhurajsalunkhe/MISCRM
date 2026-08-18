-- Five roles become three: ADMIN, BDM, BDE.
--
-- `MANAGER` and `SALES_HEAD` are removed because neither named a distinct job.
-- A BDM already held exactly the data scope a Manager held — `visibleUserIds`
-- ran them down the same branch — and differed only by two permission cells, so
-- "Manager" was a second name for the same seat. The Sales Head signs in as an
-- administrator and creates further administrators, which leaves SALES_HEAD as a
-- tier whose only distinction from ADMIN was `admin.master`.
--
-- Nobody held either role when this ran (counted: BDM 3, BDE 2, ADMIN 1,
-- MANAGER 0, SALES_HEAD 0), but the re-pointing below is written anyway. A
-- migration that assumes an empty set is a migration that corrupts the first
-- database where the set is not empty — and the enum cast further down fails
-- outright on any surviving row, so this is what keeps that from happening.
UPDATE "User" SET "role" = 'BDM' WHERE "role" = 'MANAGER';
UPDATE "User" SET "role" = 'ADMIN' WHERE "role" = 'SALES_HEAD';

-- A BDM now holds what the Manager tier held. Both rows already exist for every
-- role — the seed writes all twenty permissions per role and carries the answer
-- in `allowed` — so this flips two flags rather than inserting anything.
--
-- `commercial.payment` is the one worth reading twice: raising an invoice and
-- recording the money against it are now the same person's job. The two
-- permissions stay separate keys precisely so that can be re-drawn from
-- /admin/permissions without another migration.
UPDATE "RolePermission"
SET "allowed" = true
WHERE "role" = 'BDM'
  AND "permission" IN ('lead.delete', 'commercial.payment');

-- The matrix rows for the departing roles go. Left behind they would be
-- unreachable data that the next person to read the table would take for
-- configuration.
DELETE FROM "RolePermission" WHERE "role" IN ('MANAGER', 'SALES_HEAD');

-- `NotificationRule.role` is nullable and its table is not populated until the
-- notification centre is built, but the enum cast below cannot skip a column
-- because it is currently empty.
DELETE FROM "NotificationRule" WHERE "role" IN ('MANAGER', 'SALES_HEAD');

-- PostgreSQL has no DROP VALUE for enums, so the type is rebuilt and every
-- column carrying it is re-pointed. The USING cast goes through text because
-- there is no implicit cast between two enum types.
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'BDM', 'BDE');

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");

ALTER TABLE "RolePermission"
  ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");

ALTER TABLE "NotificationRule"
  ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");

DROP TYPE "UserRole";

ALTER TYPE "UserRole_new" RENAME TO "UserRole";
