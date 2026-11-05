CREATE TABLE `bingo_chat_events` (
	`game_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`message_id` text,
	`member_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `bingo_chat_members` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`muted_until` integer DEFAULT 0 NOT NULL,
	`last_sent_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bingo_chat_members_game_account` ON `bingo_chat_members` (`game_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `bingo_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`seq` integer NOT NULL,
	`member_id` text NOT NULL,
	`profile_id` text,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bingo_chat_messages_game_seq` ON `bingo_chat_messages` (`game_id`,`seq`);--> statement-breakpoint
CREATE TABLE `bingo_chat_operations` (
	`game_id` text NOT NULL,
	`account_id` text NOT NULL,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`result_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `account_id`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `bingo_chat_rooms` (
	`game_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_op` text DEFAULT '' NOT NULL
);
