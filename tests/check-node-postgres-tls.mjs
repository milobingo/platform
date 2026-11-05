import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { Client } from 'pg';
import { decodePostgresCa, postgresTlsOptions } from '../server/node-postgres-tls.js';

const remoteUrl = 'postgresql://test_user:test_password@db.project.supabase.co:5432/postgres';
const now = Date.now();
const trustedPem = rootCertificates.find(pem => {
  const certificate = new X509Certificate(pem);
  return certificate.ca && Date.parse(certificate.validFrom) <= now && Date.parse(certificate.validTo) > now;
});
assert(trustedPem, 'The Node trust store must contain a currently valid CA for this offline test.');
const trustedBase64 = Buffer.from(trustedPem).toString('base64');

function connectionParameters(options) {
  return new Client(options).connectionParameters;
}

test('public CA configuration decodes a currently valid certificate without a network request', () => {
  assert.equal(decodePostgresCa(undefined), undefined);
  assert.equal(decodePostgresCa(''), undefined);
  const ca = decodePostgresCa(trustedBase64);
  assert.equal(typeof ca, 'string');
  assert.equal(new X509Certificate(ca).fingerprint256, new X509Certificate(trustedPem).fingerprint256);

  const options = postgresTlsOptions(remoteUrl, { caBase64: trustedBase64 });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, ca);
  assert.equal(options.sslnegotiation, 'postgres');
  assert.equal(connectionParameters(options).ssl.ca, ca);
});

test('malformed or non-certificate CA values fail without disclosing their input', () => {
  const privateMarker = `${trustedPem}\n-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n`;
  const invalid = [
    '*not-base64*',
    trustedBase64 + '=',
    ' ' + trustedBase64,
    trustedBase64 + '\n',
    Buffer.from('credential-marker-that-must-not-appear').toString('base64'),
    Buffer.from(privateMarker).toString('base64'),
    Buffer.from(trustedPem + '\ncredential-marker-that-must-not-appear').toString('base64'),
    'A'.repeat(1024 * 1024),
    123,
    {},
  ];
  for (const value of invalid) {
    assert.throws(() => decodePostgresCa(value), error => {
      assert.doesNotMatch(error.message, /credential-marker-that-must-not-appear|not-a-key|BEGIN PRIVATE KEY/);
      return true;
    });
  }
});

test('remote connections always verify TLS, including when the loopback exception is enabled', () => {
  for (const options of [{}, { allowLoopback: true }]) {
    const parameters = connectionParameters(postgresTlsOptions(remoteUrl, options));
    assert.deepEqual(parameters.ssl, { rejectUnauthorized: true });
    assert.equal(parameters.sslnegotiation, 'postgres');
  }
});

test('unencrypted loopback connections require the explicit local exception and no CA', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `postgresql://test_user:test_password@${host}:5432/postgres`;
    assert.equal(connectionParameters(postgresTlsOptions(url)).ssl.rejectUnauthorized, true);
    assert.equal(connectionParameters(postgresTlsOptions(url, { allowLoopback: true })).ssl, false);
    assert.equal(connectionParameters(postgresTlsOptions(url, { allowLoopback: true, caBase64: trustedBase64 })).ssl.rejectUnauthorized, true);
    assert.equal(connectionParameters(postgresTlsOptions(`${url}?sslmode=verify-full`, { allowLoopback: true })).ssl.rejectUnauthorized, true);
    assert.equal(connectionParameters(postgresTlsOptions(`${url}?ssl=true`, { allowLoopback: true })).ssl.rejectUnauthorized, true);
    assert.equal(connectionParameters(postgresTlsOptions(`${url}?sslnegotiation=direct`, { allowLoopback: true })).ssl.rejectUnauthorized, true);
    assert.equal(connectionParameters(postgresTlsOptions(`${url}?sslmode=disable`, { allowLoopback: true })).ssl, false);
  }
  for (const host of ['localhost.example', '127.0.0.1.example', 'db.project.supabase.co']) {
    const parameters = connectionParameters(postgresTlsOptions(`postgresql://test_user:test_password@${host}:5432/postgres`, { allowLoopback: true }));
    assert.equal(parameters.ssl.rejectUnauthorized, true);
  }
});

test('URL TLS overrides cannot replace explicit certificate verification or read certificate paths', () => {
  const queries = [
    'sslmode=disable&ssl=0',
    'sslmode=no-verify&uselibpqcompat=true',
    'sslmode=verify-ca&uselibpqcompat=true&sslrootcert=%2Fnonexistent-milo-ca.pem',
    'sslcert=%2Fnonexistent-milo-cert.pem&sslkey=%2Fnonexistent-milo-key.pem',
    'sslnegotiation=direct',
    'SSLMode=disable&SSL=0&SSLROOTCERT=%2Fnonexistent-milo-ca.pem&UseLibpqCompat=true',
    '%73slmode=disable&sslmode=no-verify&sslmode=disable',
  ];
  for (const query of queries) {
    const options = postgresTlsOptions(`${remoteUrl}?${query}`, { caBase64: trustedBase64 });
    const remaining = [...new URL(options.connectionString).searchParams.keys()];
    assert(!remaining.some(key => /^ssl/i.test(key) || /^uselibpqcompat$/i.test(key)));
    const parameters = connectionParameters(options);
    assert.equal(parameters.ssl.rejectUnauthorized, true);
    assert.equal(parameters.ssl.ca, decodePostgresCa(trustedBase64));
    assert.equal(parameters.ssl.checkServerIdentity, undefined);
    assert.equal(parameters.sslnegotiation, 'postgres');
  }
});

test('pg environment TLS settings cannot weaken the explicit connection configuration', () => {
  const previous = { PGSSLMODE: process.env.PGSSLMODE, PGSSLNEGOTIATION: process.env.PGSSLNEGOTIATION };
  try {
    process.env.PGSSLNEGOTIATION = 'direct';
    for (const mode of ['no-verify', 'disable', 'prefer', 'require']) {
      process.env.PGSSLMODE = mode;
      const parameters = connectionParameters(postgresTlsOptions(remoteUrl, { caBase64: trustedBase64 }));
      assert.equal(parameters.ssl.rejectUnauthorized, true);
      assert.equal(parameters.ssl.ca, decodePostgresCa(trustedBase64));
      assert.equal(parameters.sslnegotiation, 'postgres');
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('query parameters cannot redirect validated database hosts or credentials', () => {
  for (const key of ['host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname', 'service', 'servicefile']) {
    for (const spelling of [key, key.toUpperCase()]) {
      assert.throws(() => postgresTlsOptions(`postgresql://test_user:test_password@127.0.0.1:5432/postgres?${spelling}=credential-marker-that-must-not-appear`, { allowLoopback: true }), error => {
        assert.doesNotMatch(error.message, /test_password|credential-marker-that-must-not-appear/);
        return true;
      });
    }
  }
});

test('invalid database URLs fail with a sanitized error', () => {
  for (const value of [
    'postgresql://sensitive_user:sensitive_password@',
    'postgresql://sensitive_user:sensitive_password@db.example:invalid/postgres',
    'https://sensitive_user:sensitive_password@db.example/postgres',
    '/var/run/postgresql sensitive_password',
  ]) {
    assert.throws(() => postgresTlsOptions(value), error => {
      assert.doesNotMatch(error.message, /sensitive_user|sensitive_password/);
      return true;
    });
  }
});
