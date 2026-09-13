CREATE TABLE "habit_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"habit_id" integer NOT NULL,
	"date" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"value" double precision,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'binary' NOT NULL,
	"unit" text,
	"target" double precision,
	"notes_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"activated_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "habit_entries_habit_date_idx" ON "habit_entries" USING btree ("habit_id","date");