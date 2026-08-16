-- Phase 4. `RequirementStageHistory.changedById` and
-- `CandidateStageHistory.changedById` existed from the initial schema but had
-- no relation behind them, so the requirement's History tab could not name who
-- moved a stage — the one question a transition log exists to answer.
-- `LeadStageHistory` has had this foreign key since the start; these two are
-- brought in line with it.
--
-- Both columns are already NOT NULL and every row in them was written by the
-- application with a real user id, so no backfill is needed.

-- AddForeignKey
ALTER TABLE "RequirementStageHistory"
  ADD CONSTRAINT "RequirementStageHistory_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateStageHistory"
  ADD CONSTRAINT "CandidateStageHistory_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
