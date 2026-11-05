-- PostgreSQL port of db/schema.ts and drizzle/0000..0008.
-- Documents remain TEXT to preserve the existing application store contract.
-- Epoch-millisecond fields use BIGINT rather than PostgreSQL INTEGER.


-- Source: 0000_broad_gravity.sql
CREATE TABLE "show_workspaces" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"document" text NOT NULL,
	"updated_at" text NOT NULL
);


-- Source: 0001_black_nemesis.sql
CREATE TABLE "bingo_families" (
	"account_id" text PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"document" text NOT NULL
);

CREATE TABLE "bingo_games" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"document" text NOT NULL,
	"updated_at" bigint NOT NULL
);


-- Source: 0002_silly_prodigy.sql
CREATE TABLE "bingo_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL
);


-- Source: 0003_eminent_meggan.sql
CREATE TABLE "bingo_chat_events" (
	"game_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"message_id" text,
	"member_id" text,
	"created_at" bigint NOT NULL,
	PRIMARY KEY("game_id", "seq")
);

CREATE TABLE "bingo_chat_members" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"account_id" text NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"muted_until" bigint DEFAULT 0 NOT NULL,
	"last_sent_at" bigint DEFAULT 0 NOT NULL
);

CREATE UNIQUE INDEX "bingo_chat_members_game_account" ON "bingo_chat_members" ("game_id","account_id");
CREATE TABLE "bingo_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"member_id" text NOT NULL,
	"profile_id" text,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint DEFAULT 0 NOT NULL
);

CREATE UNIQUE INDEX "bingo_chat_messages_game_seq" ON "bingo_chat_messages" ("game_id","seq");
CREATE TABLE "bingo_chat_operations" (
	"game_id" text NOT NULL,
	"account_id" text NOT NULL,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"result_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	PRIMARY KEY("game_id", "account_id", "request_id")
);

CREATE TABLE "bingo_chat_rooms" (
	"game_id" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"last_op" text DEFAULT '' NOT NULL
);


-- Source: 0004_nasty_sugar_man.sql
CREATE TABLE "presentation_workspaces" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"document" text NOT NULL,
	"updated_at" text NOT NULL
);


-- Source: 0005_tan_screwball.sql
CREATE TABLE "studio_outputs" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"document" text NOT NULL
);


-- Source: 0006_broad_loners.sql
CREATE TABLE "studio_calls" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"document" text NOT NULL
);


-- Source: 0007_stiff_lord_hawal.sql
CREATE TABLE "player_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" bigint NOT NULL
);

CREATE UNIQUE INDEX "player_accounts_email" ON "player_accounts" ("email");
CREATE TABLE "player_auth_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" bigint NOT NULL,
	"until" bigint NOT NULL
);

CREATE TABLE "player_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"verifier_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"consumed_at" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE "player_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);


-- Source: 0008_character_settings.sql
CREATE TABLE "show_character_settings" (
 "owner_id" text PRIMARY KEY NOT NULL,
 "revision" bigint NOT NULL,
 "document" text NOT NULL,
 "updated_at" text NOT NULL
);



CREATE TABLE public.app_user_roles (
  user_id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('regie', 'player'))
);

-- Query indexes supplement the original Drizzle constraints.
CREATE INDEX bingo_games_owner_updated ON public.bingo_games (owner_id, updated_at DESC);
CREATE INDEX bingo_codes_game ON public.bingo_codes (game_id);
CREATE INDEX bingo_chat_members_game ON public.bingo_chat_members (game_id);
CREATE INDEX player_sessions_expiry ON public.player_sessions (expires_at);
CREATE INDEX player_challenges_expiry ON public.player_challenges (expires_at);
CREATE INDEX player_auth_limits_expiry ON public.player_auth_limits (until);

-- A deployment creates a separate LOGIN role and grants it milo_backend.
-- This group can operate app data, but cannot own/drop tables or assign roles.
DO $backend$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='milo_backend') THEN
    CREATE ROLE milo_backend NOLOGIN;
  END IF;
END
$backend$;
GRANT USAGE ON SCHEMA public TO milo_backend;

-- All application access passes through the verified server identity. There
-- are deliberately no browser/Data API policies for family or game documents.
DO $security$
DECLARE table_name text;
DECLARE role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'show_workspaces','bingo_games','bingo_families','bingo_codes',
    'bingo_chat_rooms','bingo_chat_members','bingo_chat_messages',
    'bingo_chat_events','bingo_chat_operations','presentation_workspaces',
    'studio_outputs','studio_calls','player_accounts','player_sessions',
    'player_challenges','player_auth_limits','show_character_settings',
    'app_user_roles'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    IF table_name='app_user_roles' THEN
      EXECUTE 'GRANT SELECT ON TABLE public.app_user_roles TO milo_backend';
      EXECUTE 'CREATE POLICY milo_backend_read ON public.app_user_roles FOR SELECT TO milo_backend USING (true)';
    ELSE
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO milo_backend',table_name);
      EXECUTE format('CREATE POLICY milo_backend_access ON public.%I FOR ALL TO milo_backend USING (true) WITH CHECK (true)',table_name);
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',table_name);
    END IF;
  END LOOP;
END
$security$;

-- Supabase-only: a private bucket for opaque adapter envelopes. No policies
-- grant browser users access; uploads/downloads use the server secret key.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $bucket$
      INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
      VALUES ('milo-private','milo-private',false,104857600,ARRAY['application/json'])
      ON CONFLICT (id) DO UPDATE SET public=false
    $bucket$;
  END IF;
END
$storage$;
