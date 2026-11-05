CREATE TABLE `presentation_workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	`updated_at` text NOT NULL
);
