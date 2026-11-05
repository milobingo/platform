import { X509Certificate } from 'node:crypto';

const invalidCa = () => new TypeError('SUPABASE_DB_CA_BASE64 moet geldige, actuele publieke CA-certificaten als één regel base64 bevatten.');
const invalidUrl = () => new TypeError('DATABASE_URL heeft een ongeldig of afwijkend PostgreSQL-verbindingsformaat.');
const authorityKeys = new Set(['host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname', 'service', 'servicefile']);

// This is public trust material, never a private key or a filesystem path. Keep
// parsing strict so a malformed environment value fails before any connection.
export function decodePostgresCa(caBase64) {
  if (caBase64 === undefined || caBase64 === '') return undefined;
  if (typeof caBase64 !== 'string' || caBase64.length > 87_384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(caBase64)) throw invalidCa();
  const decoded = Buffer.from(caBase64, 'base64');
  if (decoded.length > 65_536 || decoded.toString('base64') !== caBase64) throw invalidCa();
  const pem = decoded.toString('utf8');
  const certificates = [...pem.matchAll(/-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----/g)];
  if (!certificates.length || certificates.length > 10 || pem.replace(/-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----/g, '').trim()) throw invalidCa();
  try {
    return certificates.map(([certificate]) => {
      const parsed = new X509Certificate(certificate);
      const now = Date.now(), from = Date.parse(parsed.validFrom), until = Date.parse(parsed.validTo);
      if (!parsed.ca || !Number.isFinite(from) || !Number.isFinite(until) || now < from || now >= until) throw invalidCa();
      return parsed.toString().trim() + '\n';
    }).join('');
  } catch { throw invalidCa(); }
}

export function postgresTlsOptions(connectionString, { caBase64, allowLoopback = false } = {}) {
  let url;
  try { url = new URL(connectionString); } catch { throw invalidUrl(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/' || url.hash || (url.port && (Number(url.port) < 1 || Number(url.port) > 65_535))) throw invalidUrl();
  for (const key of url.searchParams.keys()) if (authorityKeys.has(key.toLowerCase())) throw invalidUrl();
  const ca = decodePostgresCa(caBase64);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const requestedTls = [...url.searchParams.entries()].some(([key, value]) => {
    const name = key.toLowerCase();
    if (name === 'sslmode') return !['disable', 'allow', 'prefer'].includes(value);
    if (name === 'ssl') return !['false', '0', ''].includes(value);
    return name.startsWith('ssl') && Boolean(value);
  });
  // pg connection-string TLS fields replace the explicit ssl object. Remove
  // every variant before giving pg the authority we already validated.
  for (const key of [...url.searchParams.keys()]) if (/^ssl/i.test(key) || key.toLowerCase() === 'uselibpqcompat') url.searchParams.delete(key);
  const ssl = allowLoopback === true && loopback && !ca && !requestedTls ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  return { connectionString: url.toString(), ssl, sslnegotiation: 'postgres' };
}
