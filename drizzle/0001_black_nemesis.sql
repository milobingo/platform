CREATE TABLE `bingo_families` (
	`account_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bingo_games` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	`updated_at` integer NOT NULL
);
