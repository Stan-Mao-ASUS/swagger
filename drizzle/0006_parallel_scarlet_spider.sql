CREATE TABLE `mocks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mocks_document_id_unique` ON `mocks` (`document_id`);