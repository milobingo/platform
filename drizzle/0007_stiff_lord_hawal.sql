CREATE TABLE `player_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_accounts_email` ON `player_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `player_auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `player_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`verifier_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`consumed_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `player_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
