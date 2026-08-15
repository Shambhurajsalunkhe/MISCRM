-- Partial unique indexes covering the NULL cases in composite constraints.
--
-- PostgreSQL treats NULL as distinct from every other NULL, so a constraint
-- like UNIQUE(name, "departmentId") does NOT prevent two rows with the same
-- name and a NULL department. Prisma's schema language cannot express partial
-- indexes, so they are declared here as raw SQL.
--
-- Without these, the @@unique declarations in schema.prisma silently fail to
-- constrain exactly the rows the seed creates (departmentless teams, global
-- lead sources and lost reasons).

-- Team: names must be unique among teams with no department.
CREATE UNIQUE INDEX "Team_name_no_department_key"
  ON "Team" ("name")
  WHERE "departmentId" IS NULL;

-- LeadSource: a global source name (not tied to a vertical) must be unique.
CREATE UNIQUE INDEX "LeadSource_name_global_key"
  ON "LeadSource" ("name")
  WHERE "verticalId" IS NULL;

-- LostReason: same, for reasons that apply to every vertical.
CREATE UNIQUE INDEX "LostReason_name_global_key"
  ON "LostReason" ("name")
  WHERE "verticalId" IS NULL;

-- NotificationRule has two nullable columns in its composite key, so it needs
-- three partial indexes to cover every NULL combination.

-- 1. Global default for a notification type (no role, no user).
CREATE UNIQUE INDEX "NotificationRule_type_global_key"
  ON "NotificationRule" ("type")
  WHERE "role" IS NULL AND "userId" IS NULL;

-- 2. Role-wide rule with no specific user.
CREATE UNIQUE INDEX "NotificationRule_role_type_key"
  ON "NotificationRule" ("role", "type")
  WHERE "userId" IS NULL;

-- 3. Per-user override with no role scoping.
CREATE UNIQUE INDEX "NotificationRule_user_type_key"
  ON "NotificationRule" ("userId", "type")
  WHERE "role" IS NULL;
