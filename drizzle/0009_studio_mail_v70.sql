CREATE TABLE `bingo_payment_receipts` (
	`receipt_hash` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`order_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bingo_payment_receipts_order` ON `bingo_payment_receipts` (`game_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `studio_mail_records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `studio_mail_records_brand` ON `studio_mail_records` (`kind`,`brand_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `studio_mail_subscriptions` (
	`account_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`subscribed` integer DEFAULT 0 NOT NULL,
	`consent_version` text,
	`consent_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `brand_id`)
);
--> statement-breakpoint
CREATE INDEX `studio_mail_subscriptions_email` ON `studio_mail_subscriptions` (`email`,`brand_id`);--> statement-breakpoint
CREATE TABLE `studio_mail_suppressions` (
	`email` text NOT NULL,
	`brand_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`email`, `brand_id`)
);
--> statement-breakpoint
CREATE TABLE `studio_mail_unsubscribe` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`brand_id` text NOT NULL,
	`created_at` integer NOT NULL
);
