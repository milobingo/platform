-- Additive v70 communication and payment-receipt registry. Existing game,
-- family, book, result and settings records remain unchanged.
CREATE TABLE "bingo_payment_receipts" (
	"receipt_hash" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"order_id" text NOT NULL,
	"created_at" bigint NOT NULL
);

CREATE TABLE "studio_mail_records" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"document" text NOT NULL,
	"updated_at" bigint NOT NULL
);

CREATE TABLE "studio_mail_subscriptions" (
	"account_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"subscribed" bigint DEFAULT 0 NOT NULL,
	"consent_version" text,
	"consent_at" bigint,
	"updated_at" bigint NOT NULL,
	PRIMARY KEY("account_id", "brand_id")
);

CREATE TABLE "studio_mail_suppressions" (
	"email" text NOT NULL,
	"brand_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	PRIMARY KEY("email", "brand_id")
);

CREATE TABLE "studio_mail_unsubscribe" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"brand_id" text NOT NULL,
	"created_at" bigint NOT NULL
);

CREATE INDEX studio_mail_records_brand ON public.studio_mail_records (kind,brand_id,updated_at DESC);
CREATE INDEX studio_mail_subscriptions_email ON public.studio_mail_subscriptions (email,brand_id);
CREATE INDEX bingo_payment_receipts_order ON public.bingo_payment_receipts (game_id,order_id);

-- Browser sessions cannot inspect communication or payment evidence.
DO $mail_security$
DECLARE table_name text;
DECLARE role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['studio_mail_records','studio_mail_subscriptions','studio_mail_suppressions','studio_mail_unsubscribe','bingo_payment_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO milo_backend',table_name);
    EXECUTE format('CREATE POLICY milo_backend_access ON public.%I FOR ALL TO milo_backend USING (true) WITH CHECK (true)',table_name);
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
$mail_security$;
