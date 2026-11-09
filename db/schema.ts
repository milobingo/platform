import {sqliteTable,text,integer,uniqueIndex,primaryKey,index} from 'drizzle-orm/sqlite-core';

export const showWorkspaces=sqliteTable('show_workspaces',{
 ownerId:text('owner_id').primaryKey(),
 revision:integer('revision').notNull(),
 document:text('document').notNull(),
 updatedAt:text('updated_at').notNull(),
});
export const bingoGames=sqliteTable('bingo_games',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),revision:integer('revision').notNull(),document:text('document').notNull(),updatedAt:integer('updated_at').notNull(),
});
export const bingoFamilies=sqliteTable('bingo_families',{
 accountId:text('account_id').primaryKey(),revision:integer('revision').notNull(),document:text('document').notNull(),
});
export const bingoCodes=sqliteTable('bingo_codes',{code:text('code').primaryKey(),gameId:text('game_id').notNull()});

// Per-show chat has its own revision and durable cursor; game JSON is never rewritten by chat.
export const bingoChatRooms=sqliteTable('bingo_chat_rooms',{
 gameId:text('game_id').primaryKey(),revision:integer('revision').notNull().default(0),lastOp:text('last_op').notNull().default(''),
});
export const bingoChatMembers=sqliteTable('bingo_chat_members',{
 id:text('id').primaryKey(),gameId:text('game_id').notNull(),accountId:text('account_id').notNull(),role:text('role').notNull().default('player'),mutedUntil:integer('muted_until').notNull().default(0),lastSentAt:integer('last_sent_at').notNull().default(0),
},table=>[uniqueIndex('bingo_chat_members_game_account').on(table.gameId,table.accountId)]);
export const bingoChatMessages=sqliteTable('bingo_chat_messages',{
 id:text('id').primaryKey(),gameId:text('game_id').notNull(),seq:integer('seq').notNull(),memberId:text('member_id').notNull(),profileId:text('profile_id'),name:text('name').notNull(),role:text('role').notNull(),body:text('body').notNull(),createdAt:integer('created_at').notNull(),deletedAt:integer('deleted_at').notNull().default(0),
},table=>[uniqueIndex('bingo_chat_messages_game_seq').on(table.gameId,table.seq)]);
export const bingoChatEvents=sqliteTable('bingo_chat_events',{
 gameId:text('game_id').notNull(),seq:integer('seq').notNull(),type:text('type').notNull(),messageId:text('message_id'),memberId:text('member_id'),createdAt:integer('created_at').notNull(),
},table=>[primaryKey({columns:[table.gameId,table.seq]})]);
export const bingoChatOperations=sqliteTable('bingo_chat_operations',{
 gameId:text('game_id').notNull(),accountId:text('account_id').notNull(),requestId:text('request_id').notNull(),action:text('action').notNull(),resultId:text('result_id').notNull(),createdAt:integer('created_at').notNull(),
},table=>[primaryKey({columns:[table.gameId,table.accountId,table.requestId]})]);

export const presentationWorkspaces=sqliteTable('presentation_workspaces',{ownerId:text('owner_id').primaryKey(),revision:integer('revision').notNull(),document:text('document').notNull(),updatedAt:text('updated_at').notNull()});

export const studioOutputs=sqliteTable('studio_outputs',{ownerId:text('owner_id').primaryKey(),revision:integer('revision').notNull(),document:text('document').notNull()});

// One call per host, with CAS revisions for invitation/signaling/termination races.
export const studioCalls=sqliteTable('studio_calls',{ownerId:text('owner_id').primaryKey(),gameId:text('game_id').notNull(),revision:integer('revision').notNull(),document:text('document').notNull()});

export const playerAccounts=sqliteTable('player_accounts',{id:text('id').primaryKey(),email:text('email').notNull(),createdAt:integer('created_at').notNull()},t=>[uniqueIndex('player_accounts_email').on(t.email)]);
export const playerSessions=sqliteTable('player_sessions',{tokenHash:text('token_hash').primaryKey(),accountId:text('account_id').notNull(),expiresAt:integer('expires_at').notNull(),createdAt:integer('created_at').notNull()});
export const playerChallenges=sqliteTable('player_challenges',{id:text('id').primaryKey(),email:text('email').notNull(),verifierHash:text('verifier_hash').notNull(),codeHash:text('code_hash').notNull(),attempts:integer('attempts').notNull().default(0),expiresAt:integer('expires_at').notNull(),createdAt:integer('created_at').notNull(),consumedAt:integer('consumed_at').notNull().default(0)});
export const playerAuthLimits=sqliteTable('player_auth_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),until:integer('until').notNull()});

// Per-owner cast preferences; API credentials remain exclusively in the global secret store.
export const showCharacterSettings=sqliteTable('show_character_settings',{ownerId:text('owner_id').primaryKey(),revision:integer('revision').notNull(),document:text('document').notNull(),updatedAt:text('updated_at').notNull()});

// Communication history is independent of the frequently updated show document.
export const studioMailRecords=sqliteTable('studio_mail_records',{
 id:text('id').primaryKey(),kind:text('kind').notNull(),brandId:text('brand_id').notNull(),ownerId:text('owner_id').notNull(),revision:integer('revision').notNull(),document:text('document').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[index('studio_mail_records_brand').on(t.kind,t.brandId,t.updatedAt)]);
export const studioMailSubscriptions=sqliteTable('studio_mail_subscriptions',{
 accountId:text('account_id').notNull(),brandId:text('brand_id').notNull(),email:text('email').notNull(),name:text('name').notNull().default(''),subscribed:integer('subscribed').notNull().default(0),consentVersion:text('consent_version'),consentAt:integer('consent_at'),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.accountId,t.brandId]}),index('studio_mail_subscriptions_email').on(t.email,t.brandId)]);
export const studioMailSuppressions=sqliteTable('studio_mail_suppressions',{
 email:text('email').notNull(),brandId:text('brand_id').notNull(),createdAt:integer('created_at').notNull(),
},t=>[primaryKey({columns:[t.email,t.brandId]})]);
export const studioMailUnsubscribe=sqliteTable('studio_mail_unsubscribe',{
 tokenHash:text('token_hash').primaryKey(),email:text('email').notNull(),brandId:text('brand_id').notNull(),createdAt:integer('created_at').notNull(),
});
export const bingoPaymentReceipts=sqliteTable('bingo_payment_receipts',{
 receiptHash:text('receipt_hash').primaryKey(),gameId:text('game_id').notNull(),orderId:text('order_id').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('bingo_payment_receipts_order').on(t.gameId,t.orderId)]);
