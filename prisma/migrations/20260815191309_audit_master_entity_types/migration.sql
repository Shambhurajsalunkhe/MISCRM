-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'TEAM';
ALTER TYPE "EntityType" ADD VALUE 'DEPARTMENT';
ALTER TYPE "EntityType" ADD VALUE 'ROLE_PERMISSION';
ALTER TYPE "EntityType" ADD VALUE 'SALES_VERTICAL';
ALTER TYPE "EntityType" ADD VALUE 'PIPELINE_STAGE';
ALTER TYPE "EntityType" ADD VALUE 'VERTICAL_METRIC';
ALTER TYPE "EntityType" ADD VALUE 'REQUIREMENT_STAGE';
ALTER TYPE "EntityType" ADD VALUE 'CANDIDATE_STAGE';
ALTER TYPE "EntityType" ADD VALUE 'REQUIREMENT_TYPE';
ALTER TYPE "EntityType" ADD VALUE 'LEAD_SOURCE';
ALTER TYPE "EntityType" ADD VALUE 'LOST_REASON';
ALTER TYPE "EntityType" ADD VALUE 'SERVICE';
ALTER TYPE "EntityType" ADD VALUE 'PRODUCT';
ALTER TYPE "EntityType" ADD VALUE 'COUNTRY';
ALTER TYPE "EntityType" ADD VALUE 'TAG';
ALTER TYPE "EntityType" ADD VALUE 'APP_SETTING';
ALTER TYPE "EntityType" ADD VALUE 'EMAIL_TEMPLATE';
