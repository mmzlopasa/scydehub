import nodemailer from 'nodemailer';
import { fetch } from 'undici';
import { q, json } from '../db.js';
import { decrypt, encrypt, isEncrypted, isLegacyCipher } from '../lib/crypto.js';
import type { ConfigField, Severity } from '../plugins/types.js';

export interface Notification { title: string; message: string; severity: Severity; resolved?: boolean; url?: string }

export interface ChannelType {
  id: string; name: string; fields: ConfigField[];
  send(cfg: Record<string, any>, n: Notification): Promise<void>;
}

const emoji = (n: Notification) => (n.resolved ? '✅' : n.severity === 'critical' ? '🔴' : n.severity === 'warning' ? '🟠' : 'ℹ️');

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export const channelTypes: ChannelType[] = [
  {
    id: 'ntfy', name: 'ntfy',
    fields: [
      { key: 'url', label: 'Server', type: 'url', default: 'https://ntfy.sh', required: true },
      { key: 'topic', label: 'Topic', type: 'string', required: true },
      { key: 'token', label: 'Access token (optional)', type: 'secret' },
    ],
    async send(c, n) {
      const res = await fetch(String(c.url).replace(/\/+$/, '') + '/' + encodeURIComponent(c.topic), {
        method: 'POST',
        headers: {
          // RFC 2047 encoded-word so non-ASCII titles (č, ć, š…) survive HTTP headers; ntfy decodes it
          Title: `=?UTF-8?B?${Buffer.from(n.title, 'utf8').toString('base64')}?=`,
          Priority: n.resolved ? '3' : n.severity === 'critical' ? '5' : n.severity === 'warning' ? '4' : '3',
          Tags: n.resolved ? 'white_check_mark' : n.severity === 'critical' ? 'rotating_light' : 'warning',
          ...(n.url ? { Click: asciiUrl(n.url) } : {}),
          ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
        },
        body: n.message,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
    },
  },
  {
    id: 'gotify', name: 'Gotify',
    fields: [
      { key: 'url', label: 'Server', type: 'url', required: true },
      { key: 'token', label: 'App token', type: 'secret', required: true },
    ],
    send: (c, n) =>
      post(String(c.url).replace(/\/+$/, '') + '/message', {
        title: `${emoji(n)} ${n.title}`, message: n.message, priority: n.resolved ? 4 : n.severity === 'critical' ? 9 : 6,
      }, { 'X-Gotify-Key': c.token }),
  },
  {
    id: 'telegram', name: 'Telegram',
    fields: [
      { key: 'botToken', label: 'Bot token', type: 'secret', required: true },
      { key: 'chatId', label: 'Chat ID', type: 'string', required: true },
    ],
    send: (c, n) =>
      post(`https://api.telegram.org/bot${c.botToken}/sendMessage`, {
        chat_id: c.chatId, text: `${emoji(n)} <b>${esc(n.title.slice(0, 300))}</b>\n${esc(n.message.slice(0, 3000))}`, parse_mode: 'HTML', disable_web_page_preview: true,
      }),
  },
  {
    id: 'discord', name: 'Discord webhook',
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true }],
    send: (c, n) =>
      post(c.webhookUrl, {
        username: 'SCYDE Hub',
        embeds: [{ title: `${emoji(n)} ${n.title}`.slice(0, 256), description: n.message.slice(0, 4000), color: n.resolved ? 0x22c55e : n.severity === 'critical' ? 0xef4444 : 0xf59e0b, timestamp: new Date().toISOString(), url: n.url }],
      }),
  },
  {
    id: 'email', name: 'E-mail (SMTP)',
    fields: [
      { key: 'host', label: 'SMTP host', type: 'string', required: true },
      { key: 'port', label: 'Port', type: 'number', default: 587 },
      { key: 'secure', label: 'Implicit TLS (port 465)', type: 'boolean', default: false },
      { key: 'allowPlain', label: 'Allow an unencrypted connection (trusted local relay only)', type: 'boolean', default: false },
      { key: 'user', label: 'Username', type: 'string' },
      { key: 'pass', label: 'Password', type: 'secret' },
      { key: 'from', label: 'From', type: 'string', required: true },
      { key: 'to', label: 'To', type: 'string', required: true },
    ],
    async send(c, n) {
      // without implicit TLS the connection must upgrade with STARTTLS before the password is sent — never in the clear
      const t = nodemailer.createTransport({
        host: c.host, port: Number(c.port) || 587, secure: !!c.secure, requireTLS: !c.secure && !c.allowPlain,
        auth: c.user ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      });
      await t.sendMail({ from: c.from, to: c.to, subject: `${emoji(n)} [SCYDE Hub] ${n.title}`.replace(/[\r\n]+/g, ' ').slice(0, 250), text: n.message + (n.url ? `\n\n${n.url}` : '') });
    },
  },
];

/** HTTP header values must be ASCII: international host names and paths are converted (punycode, percent-encoding) */
const asciiUrl = (u: string) => { try { return new URL(u).href; } catch { return encodeURI(u); } };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const getChannelType = (id: string) => channelTypes.find((c) => c.id === id);

export interface ChannelRow { id: string; type: string; name: string; config: string; enabled: number; created_at: number }

export function channelSecrets(type: string) {
  return new Set((getChannelType(type)?.fields ?? []).filter((f) => f.type === 'secret').map((f) => f.key));
}
const caad = (id: string, field: string) => `chan:${id}:${field}`;
/** fields that decide where a notification (and its credentials) is sent */
const ROUTING = ['url', 'host', 'port'];

export function encodeChannelConfig(type: string, id: string, incoming: Record<string, any>, prevRaw?: string) {
  const t = getChannelType(type);
  if (!t) throw new Error('Unknown channel type');
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('config must be an object');
  const prev = json<Record<string, any>>(prevRaw, {});
  const out: Record<string, any> = {};
  const rerouted = !!prevRaw && ROUTING.some((k) => k in incoming && String(incoming[k] ?? '') !== String(prev[k] ?? ''));
  for (const f of t.fields) {
    let v = incoming[f.key];
    if (v === undefined || v === '' || v === null) v = f.type === 'secret' ? v : f.default; // defaults (e.g. https://ntfy.sh) apply on the server
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'secret') {
      if (v === '__unchanged__') {
        if (!prev[f.key]) continue;
        if (rerouted) throw new Error(`The server address changed — re-enter "${f.label}"`);
        out[f.key] = prev[f.key];
      } else {
        if (typeof v !== 'string' || v.length > 8192) throw new Error(`${f.label}: invalid value`);
        out[f.key] = encrypt(v, caad(id, f.key));
      }
    } else if (f.type === 'boolean') out[f.key] = v === true || v === 'true';
    else if (f.type === 'number') out[f.key] = Number(v) || 0;
    else {
      const sv = String(v).slice(0, 2048);
      if (f.type === 'url' && !/^https?:\/\/[^\s]+$/i.test(sv)) throw new Error(`${f.label}: must start with http:// or https://`);
      out[f.key] = sv;
    }
  }
  return JSON.stringify(out);
}
export function publicChannel(r: ChannelRow) {
  const c = json<Record<string, any>>(r.config, {});
  for (const k of channelSecrets(r.type)) if (c[k]) c[k] = '__unchanged__';
  return { ...r, config: c, enabled: !!r.enabled };
}
function decryptConfig(r: ChannelRow) {
  const c = json<Record<string, any>>(r.config, {});
  const secrets = channelSecrets(r.type);
  for (const k of Object.keys(c)) {
    if (!isEncrypted(c[k])) continue;
    if (!secrets.has(k)) { delete c[k]; continue; }
    try { c[k] = decrypt(c[k], caad(r.id, k)); } catch { c[k] = ''; }
  }
  return c;
}

/** One-time upgrade: bind legacy (v1) ciphertexts to their channel + field. */
export function upgradeChannelSecrets() {
  for (const r of q.all<ChannelRow>('SELECT * FROM channels')) {
    const c = json<Record<string, any>>(r.config, {});
    const secrets = channelSecrets(r.type);
    let changed = false;
    for (const k of Object.keys(c)) {
      if (!isLegacyCipher(c[k]) || !secrets.has(k)) continue;
      try { c[k] = encrypt(decrypt(c[k]), caad(r.id, k)); changed = true; } catch { /* other key */ }
    }
    if (changed) q.run('UPDATE channels SET config = ? WHERE id = ?', JSON.stringify(c), r.id);
  }
}

export async function sendTo(channelIds: string[] | 'all', n: Notification) {
  const rows = q.all<ChannelRow>('SELECT * FROM channels WHERE enabled = 1');
  const targets = channelIds === 'all' ? rows : rows.filter((r) => channelIds.includes(r.id));
  await Promise.all(
    targets.map(async (r) => {
      const t = getChannelType(r.type);
      if (!t) return;
      try {
        await t.send(decryptConfig(r), n);
      } catch (e: any) {
        console.error(`[alerts] channel ${r.name} failed:`, e?.message ?? e);
      }
    }),
  );
}

export async function testChannel(r: ChannelRow) {
  const t = getChannelType(r.type);
  if (!t) throw new Error('Unknown channel');
  await t.send(decryptConfig(r), { title: 'Test notification', message: 'SCYDE Hub channel is working.', severity: 'info' });
}
