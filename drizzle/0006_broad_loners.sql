CREATE TABLE `studio_calls` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL
);
