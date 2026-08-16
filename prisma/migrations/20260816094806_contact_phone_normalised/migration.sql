-- The old index served a `contains` lookup that could never match: duplicate
-- detection and phone search normalise their input to digits, while `phone`
-- stores whatever the user typed. Replaced by an indexed equality column.

-- DropIndex
DROP INDEX "ClientContact_phone_idx";

-- AlterTable
ALTER TABLE "ClientContact" ADD COLUMN     "phoneNormalised" TEXT;

-- Backfill existing rows with the same rule the application applies on write
-- (src/lib/dedupe.ts `normalisePhone`): digits only, last ten kept, and NULL
-- for anything too short to be a phone number. Without this, every contact
-- entered before today stays invisible to the duplicate check.
UPDATE "ClientContact"
SET "phoneNormalised" = RIGHT(regexp_replace("phone", '\D', '', 'g'), 10)
WHERE "phone" IS NOT NULL
  AND length(regexp_replace("phone", '\D', '', 'g')) >= 7;

-- CreateIndex
CREATE INDEX "ClientContact_phoneNormalised_idx" ON "ClientContact"("phoneNormalised");
