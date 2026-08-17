-- Staffing is no longer open to the whole sales floor. A team is flagged for it
-- at /admin/teams; Admin and Sales Head bypass the flag entirely.
--
-- The default is false, so every existing team loses staffing on deploy and an
-- administrator turns it back on for the one team that does the work. Defaulting
-- to true would have kept the very state this change exists to end.
ALTER TABLE "Team" ADD COLUMN "staffingAccess" BOOLEAN NOT NULL DEFAULT false;
