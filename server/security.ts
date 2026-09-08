import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
export const token = () => randomBytes(32).toString('base64url');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function seal(value: unknown, key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error('The server encryption key is not configured.');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  return [
    iv.toString('hex'),
    c.update(JSON.stringify(value), 'utf8', 'hex') + c.final('hex'),
    c.getAuthTag().toString('hex'),
  ].join('.');
}
export function unseal<T>(value: string, key: string): T {
  const [iv, data, tag] = value.split('.');
  const d = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'hex'),
  );
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(d.update(data, 'hex', 'utf8') + d.final('utf8'));
}
export const githubSignature = (body: string, secret: string) =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /password|secret|token|authorization|api.?key/i.test(k)
          ? '[redacted]'
          : scrub(v),
      ]),
    );
  if (typeof value === 'string')
    return value
      .replace(
        /https:\/\/hooks\.slack\.com\/services\/[^\s"']+/g,
        '[redacted Slack webhook]',
      )
      .slice(0, 20000);
  return value;
}
