CREATE TABLE `document_versions` (
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`document_id`, `version`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_object_key_unique` ON `document_versions` (`object_key`);--> statement-breakpoint
ALTER TABLE `documents` ADD `current_version` integer DEFAULT 1 NOT NULL;