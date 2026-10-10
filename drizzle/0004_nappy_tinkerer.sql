ALTER TABLE `publications` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `publications` ADD `expires_at` text;