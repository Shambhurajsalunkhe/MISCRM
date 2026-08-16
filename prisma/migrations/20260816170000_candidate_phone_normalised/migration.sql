-- Phase 4. The same fix `ClientContact` got in migration
-- 20260816094806: duplicate detection and the candidate search normalise a
-- typed number to digits, while `phone` keeps whatever the user typed, so an
-- index on `phone` served a lookup that could never match.

-- DropIndex
DROP INDEX "Candidate_phone_idx";

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "phoneNormalised" TEXT;

-- Backfill with the rule `normalisePhone` applies on write (src/lib/dedupe.ts):
-- digits only, last ten kept, NULL for anything too short to be a number.
UPDATE "Candidate"
SET "phoneNormalised" = RIGHT(regexp_replace("phone", '\D', '', 'g'), 10)
WHERE "phone" IS NOT NULL
  AND length(regexp_replace("phone", '\D', '', 'g')) >= 7;

-- CreateIndex
CREATE INDEX "Candidate_phoneNormalised_idx" ON "Candidate"("phoneNormalised");
