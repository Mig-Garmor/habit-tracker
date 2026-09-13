ALTER TABLE "habits" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Seed each existing row with a distinct position matching the order it is
-- shown in today (by id). Leaving them all at 0 would still render correctly,
-- since lists tie-break on id, but distinct values mean the first drag moves
-- one row rather than rewriting every position at once.
UPDATE "habits" SET "position" = "id";
