-- The service catalogue goes.
--
-- The lead forms stopped offering a service, which left `/admin/master/services`
-- editing a table no screen read and `Lead.serviceId` a column nothing wrote.
-- Both are removed rather than left as furniture: a master-data screen that
-- changes nothing visible is worse than no screen, because somebody eventually
-- curates it and wonders why the work never shows up.
--
-- Safe to drop outright here: the table held 0 rows, 0 leads carried a
-- serviceId, and 0 audit rows referenced a SERVICE entity. Had any lead carried
-- one, this would have needed a decision about where that value goes instead —
-- the column was deliberately left in place by the commit that removed the form
-- field, precisely so that decision could not be taken by accident.
--
-- `EntityType.SERVICE` is deliberately NOT removed from the enum. AuditLog is
-- append-only history: a deployment that did record a service edit would need
-- that history deleted to drop the value, which is a worse trade than one spare
-- label in a vocabulary.

ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_serviceId_fkey";

ALTER TABLE "Lead" DROP COLUMN IF EXISTS "serviceId";

DROP TABLE IF EXISTS "Service";
