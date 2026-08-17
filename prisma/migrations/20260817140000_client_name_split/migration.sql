-- Client identity splits in two: a required `clientName` and an optional
-- `companyName`.
--
-- Every vertical's lead form opens by asking what the client is called, and for
-- Upwork, LinkedIn, Email, Cold Calling, Digital Marketing and Other Sources
-- that is all anybody knows at intake — often a person, not a firm. Only
-- Staffing and Product Sales routinely learn the registered company, and even
-- there it is not knowable on day one. Requiring it everywhere meant the client's
-- own name got typed into the company field to get past the validation, which
-- left the column holding two different kinds of thing.
--
-- `companyName` is therefore RENAMED to `clientName` and keeps every existing
-- value: that is what the column has actually contained all along. A fresh,
-- nullable `companyName` is added beside it for the registered entity.
--
-- `dedupeKey` needs no backfill. It was built from the old `companyName` and is
-- now built from `clientName` — the same string, under a new name — so existing
-- keys stay correct and the unique constraint keeps holding across the rename.

ALTER TABLE "Client" RENAME COLUMN "companyName" TO "clientName";

ALTER INDEX "Client_companyName_idx" RENAME TO "Client_clientName_idx";

ALTER TABLE "Client" ADD COLUMN "companyName" TEXT;
