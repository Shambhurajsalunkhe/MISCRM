-- A user works a vertical, not a team.
--
-- The teams were named after the verticals -- Upwork, LinkedIn, Email, Cold
-- Calling, Staffing, Digital Marketing, Product Sales -- and carried nothing the
-- vertical did not already say. Two columns for one fact, and the lead already
-- had `verticalId`, so the team filter on a lead list was a second spelling of
-- the vertical filter beside it.
--
-- This fences what somebody may CREATE, not what they may see: the lead form is
-- pinned to their vertical, while visibility stays with the reporting tree so a
-- lead handed across verticals is still workable by the person holding it.
ALTER TABLE "User" ADD COLUMN "verticalId" TEXT;

CREATE INDEX "User_verticalId_idx" ON "User"("verticalId");

ALTER TABLE "User" ADD CONSTRAINT "User_verticalId_fkey"
  FOREIGN KEY ("verticalId") REFERENCES "SalesVertical"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Move everybody to the vertical their team was named after, which is the
-- mapping asked for: somebody in the LinkedIn team works the LinkedIn vertical.
--
-- Matched on name rather than on a hand-written list of ids, so it holds for any
-- database whose teams follow the same convention. A team whose name matches no
-- vertical leaves its members with a null vertical, which reads as "not fenced"
-- -- the safe direction, since the alternative is a person who cannot create a
-- lead at all and no obvious reason why.
UPDATE "User" u
SET "verticalId" = v."id"
FROM "Team" t
JOIN "SalesVertical" v ON v."name" = t."name"
WHERE u."teamId" = t."id";
