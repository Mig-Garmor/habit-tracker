ALTER TABLE `habit_entries` ADD `value` real;--> statement-breakpoint
ALTER TABLE `habit_entries` ADD `note` text;--> statement-breakpoint
ALTER TABLE `habits` ADD `kind` text DEFAULT 'binary' NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `unit` text;--> statement-breakpoint
ALTER TABLE `habits` ADD `target` real;--> statement-breakpoint
ALTER TABLE `habits` ADD `notes_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `activated_at` text;--> statement-breakpoint
ALTER TABLE `habits` DROP COLUMN `archived_at`;--> statement-breakpoint
UPDATE habits SET activated_at = date(created_at) WHERE status = 'active' AND activated_at IS NULL;