-- Review-only until the public key/nonce from the fixed target are inserted.
-- No existing password, PostgreSQL reserved-role membership, filesystem access,
-- SECURITY DEFINER function, application role grant or schema migration.
BEGIN;
SET LOCAL search_path=pg_catalog,extensions;
SELECT pg_advisory_xact_lock(hashtextextended('milo-production-admin-credential',0));
DO $milo_existing_objects$
BEGIN
  IF current_user<>'postgres' OR current_database()<>'postgres' THEN
    RAISE EXCEPTION 'Wrong bootstrap identity';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='milo_bootstrap'
            AND (nspowner<>'postgres'::regrole OR EXISTS(
              SELECT 1 FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner)))
              WHERE grantee<>'postgres'::regrole))) THEN
    RAISE EXCEPTION 'Existing private bootstrap schema is untrusted';
  END IF;
  IF to_regclass('milo_bootstrap.credential_handoffs') IS NOT NULL AND (
       NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('milo_bootstrap.credential_handoffs')
                  AND relkind='r' AND relowner='postgres'::regrole AND relrowsecurity)
       OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
                  WHERE c.oid=to_regclass('milo_bootstrap.credential_handoffs') AND a.grantee<>'postgres'::regrole)
       OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('milo_bootstrap.credential_handoffs'))
       OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
            WHERE attrelid=to_regclass('milo_bootstrap.credential_handoffs') AND attnum>0 AND NOT attisdropped)
          <> ARRAY['role_name','project_ref','nonce','public_key_fingerprint','encryption_key_fingerprint','ciphertext','created_at']) THEN
    RAISE EXCEPTION 'Existing private handoff ledger is untrusted';
  END IF;
END
$milo_existing_objects$;
CREATE SCHEMA IF NOT EXISTS milo_bootstrap AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA milo_bootstrap FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS milo_bootstrap.credential_handoffs (
  role_name text PRIMARY KEY,
  project_ref text NOT NULL,
  nonce text NOT NULL UNIQUE,
  public_key_fingerprint text NOT NULL,
  encryption_key_fingerprint text NOT NULL,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE milo_bootstrap.credential_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE milo_bootstrap.credential_handoffs FROM PUBLIC,anon,authenticated,service_role;

DO $milo_private_bootstrap$
DECLARE
  target_role constant text := 'milobingo_production_admin_bootstrap';
  target_ref constant text := 'msupvdycmtbycaonqgan';
  target_nonce constant text := 'adba0d90bcd86b44ab25262cbcd8a2363c633b73061407d390bd1adb0725a6a3';
  target_fingerprint constant text := '598C155F3A19C7A188341C400A7F43DF2F146FD9';
  target_encryption_fingerprint constant text := 'E554080A345E888545AC160BC185FE0B9B103D21';
  public_key constant text := '-----BEGIN PGP PUBLIC KEY BLOCK-----

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
+XM=
=ay+5
-----END PGP PUBLIC KEY BLOCK-----
';
  recovery milo_bootstrap.credential_handoffs%ROWTYPE;
  generated_password text;
  encrypted_payload text;
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong bootstrap identity';
  END IF;
  SELECT * INTO recovery FROM milo_bootstrap.credential_handoffs WHERE role_name=target_role;
  IF FOUND THEN
    IF recovery.project_ref<>target_ref OR recovery.nonce<>target_nonce
       OR recovery.public_key_fingerprint<>target_fingerprint
       OR recovery.encryption_key_fingerprint<>target_encryption_fingerprint
       OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      RAISE EXCEPTION 'Existing handoff differs; refuse rotation';
    END IF;
    -- Recover precisely the existing ciphertext; never reset a password.
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role)
     OR EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') THEN
    RAISE EXCEPTION 'First bootstrap requires a new role and no application tables';
  END IF;
  generated_password := encode(extensions.gen_random_bytes(32),'hex');
  IF upper(extensions.pgp_key_id(extensions.dearmor(public_key))) <> right(target_encryption_fingerprint,16) THEN
    RAISE EXCEPTION 'Selected encryption recipient differs';
  END IF;
  encrypted_payload := encode(extensions.pgp_pub_encrypt(
    jsonb_build_object('format',1,'projectRef',target_ref,'hostname','dg-nxttrack-01',
      'role',target_role,'nonce',target_nonce,'fingerprint',target_fingerprint,
      'encryptionFingerprint',target_encryption_fingerprint,
      'password',generated_password)::text,
    extensions.dearmor(public_key),'cipher-algo=aes256,compress-algo=0'),'base64');
  PERFORM set_config('password_encryption','scram-sha-256',true);
  EXECUTE format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION BYPASSRLS PASSWORD %L',target_role,generated_password);
  generated_password := NULL;
  EXECUTE format('GRANT pg_read_all_data TO %I WITH INHERIT TRUE, SET FALSE',target_role);
  EXECUTE format('GRANT CONNECT,CREATE ON DATABASE postgres TO %I',target_role);
  EXECUTE format('GRANT USAGE,CREATE ON SCHEMA public TO %I WITH GRANT OPTION',target_role);
  EXECUTE format('GRANT INSERT,UPDATE ON TABLE storage.buckets TO %I',target_role);
  INSERT INTO milo_bootstrap.credential_handoffs(role_name,project_ref,nonce,public_key_fingerprint,encryption_key_fingerprint,ciphertext)
    VALUES(target_role,target_ref,target_nonce,target_fingerprint,target_encryption_fingerprint,encrypted_payload);
EXCEPTION WHEN OTHERS THEN
  -- Do not surface driver/DDL detail: it might include a generated password.
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Milo production administrator bootstrap refused; no credential details returned';
END
$milo_private_bootstrap$;
COMMIT;

SELECT jsonb_build_object('format',1,'projectRef',project_ref,'hostname','dg-nxttrack-01',
  'role',role_name,'nonce',nonce,'fingerprint',public_key_fingerprint,
  'encryptionFingerprint',encryption_key_fingerprint,'ciphertext',ciphertext)
  AS encrypted_handoff
FROM milo_bootstrap.credential_handoffs
WHERE role_name='milobingo_production_admin_bootstrap';
