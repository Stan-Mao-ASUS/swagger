CREATE TABLE `drafts` (
	`user_id` text NOT NULL,
	`draft_key` text NOT NULL,
	`document_id` text,
	`revision` integer NOT NULL,
	`object_key` text,
	`file_name` text NOT NULL,
	`source_type` text NOT NULL,
	`base_version` integer,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `draft_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
