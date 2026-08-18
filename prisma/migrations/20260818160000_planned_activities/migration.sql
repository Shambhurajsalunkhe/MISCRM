-- Activities can now be plans as well as records.
--
-- A BDM had nowhere to arrange a call. `Activity` recorded what had happened,
-- and the only forward-looking field was `followUpDate`, which is a date with no
-- time and one per lead -- enough to chase a deal, not enough to hold "call the
-- CTO at 15:30 on Thursday". `isPlanned` splits the same table in two: false is
-- the history it has always held, true is the diary.
--
-- One column rather than a second table because the two carry identical fields,
-- and completing a plan is a state change rather than a copy -- clearing the
-- flag turns the arrangement into the record of what happened.
--
-- Defaults false, so every existing row stays a record. Nothing to back-fill.
ALTER TABLE "Activity" ADD COLUMN "isPlanned" BOOLEAN NOT NULL DEFAULT false;

-- The upcoming-calls panel asks one question: this person's plans, soonest
-- first. Without this it is a scan of every activity ever logged, and the
-- timeline is the largest table in the application by row count.
CREATE INDEX "Activity_userId_isPlanned_activityDate_idx"
  ON "Activity"("userId", "isPlanned", "activityDate");
