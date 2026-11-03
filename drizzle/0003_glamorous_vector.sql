CREATE TABLE "habit_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"habit_id" integer NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "habit_entries" ADD COLUMN "steps" integer[];--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "slot" text DEFAULT 'evening' NOT NULL;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "weekdays" integer[] DEFAULT '{1,2,3,4,5,6,7}' NOT NULL;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "question" text;--> statement-breakpoint
ALTER TABLE "habit_steps" ADD CONSTRAINT "habit_steps_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;