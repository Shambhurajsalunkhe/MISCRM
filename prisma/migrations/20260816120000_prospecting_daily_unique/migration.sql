-- One prospecting counter row per person, per metric, per day.
--
-- The weekly grid at /prospecting saves a whole week in one submit, and it has
-- to be safe to save the same week twice: a re-submit must correct Tuesday's
-- number, not add a second Tuesday. That is an upsert, and an upsert needs a
-- unique key to conflict on.
--
-- Rows are folded before the index is created rather than letting the migration
-- fail on live data. `count` is summed because every counter query is a SUM
-- already, so folding two rows into one leaves every total unchanged; the
-- earliest row wins for the other columns. No screen has ever written this
-- table, so this is a guard rather than a fix.
WITH folded AS (
  SELECT
    "userId",
    "verticalId",
    "metricId",
    "activityDate",
    MIN("id")   AS keep_id,
    SUM("count") AS total
  FROM "ProspectingActivity"
  GROUP BY "userId", "verticalId", "metricId", "activityDate"
  HAVING COUNT(*) > 1
)
UPDATE "ProspectingActivity" a
SET "count" = folded.total
FROM folded
WHERE a."id" = folded.keep_id;

DELETE FROM "ProspectingActivity" a
USING "ProspectingActivity" b
WHERE a."userId" = b."userId"
  AND a."verticalId" = b."verticalId"
  AND a."metricId" = b."metricId"
  AND a."activityDate" = b."activityDate"
  AND a."id" > b."id";

-- CreateIndex
CREATE UNIQUE INDEX "ProspectingActivity_userId_verticalId_metricId_activityDate_key" ON "ProspectingActivity"("userId", "verticalId", "metricId", "activityDate");
