import nodemailer from 'nodemailer';
import { fetch } from 'undici';
import { q, json } from '../db.js';
import { decrypt, encrypt, isEncrypted } from '../lib/crypto.js';
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
      { key: 'token', label: 'Access token (opcionalno)', type: 'secret' },
    ],
    async send(c, n) {
      const res = await fetch(String(c.url).replace(/\/+$/, '') + '/' + encodeURIComponent(c.topic), {
        method: 'POST',
        headers: {
          // RFC 2047 encoded-word so non-ASCII titles (č, ć, š…) survive HTTP headers; ntfy decodes it
          Title: `=?UTF-8?B?${Buffer.from(n.title, 'utf8').toString('base64')}?=`,
          Priority: n.resolved ? '3' : n.severity === 'critical' ? '5' : n.severity === 'warning' ? '4' : '3',
          Tags: n.resolved ? 'white_check_mark' : n.severity === 'critical' ? 'rotating_light' : 'warning',
          ...(n.url ? { Click: n.url } : {}),
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
        chat_id: c.chatId, text: `${emoji(n)} <b>${esc(n.title)}</b>\n${esc(n.message)}`, parse_mode: 'HTML', disable_web_page_preview: true,
      }),
  },
  {
    id: 'discord', name: 'Discord webhook',
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true }],
    send: (c, n) =>
      post(c.webhookUrl, {
        username: 'SCYDE Hub',
        embeds: [{ title: `${emoji(n)} ${n.title}`, description: n.message, color: n.resolved ? 0x22c55e : n.severity === 'critical' ? 0xef4444 : 0xf59e0b, timestamp: new Date().toISOString(), url: n.url }],
      }),
  },
  {
    id: 'email', name: 'E-mail (SMTP)',
    fields: [
      { key: 'host', label: 'SMTP host', type: 'string', required: true },
      { key: 'port', label: 'Port', type: 'number', default: 587 },
      { key: 'secure', label: 'TLS od početka (port 465)', type: 'boolean', default: false },
      { key: 'user', label: 'Korisnik', type: 'string' },
      { key: 'pass', label: 'Lozinka', type: 'secret' },
      { key: 'from', label: 'Od', type: 'string', required: true },
      { key: 'to', label: 'Za', type: 'string', required: true },
    ],
    async send(c, n) {
      const t = nodemailer.createTransport({ host: c.host, port: Number(c.port) || 587, secure: !!c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
      await t.sendMail({ from: c.from, to: c.to, subject: `${emoji(n)} [SCYDE Hub] ${n.title}`, text: n.message + (n.url ? `\n\n${n.url}` : '') });
    },
  },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const getChannelType = (id: string) => channelTypes.find((c) => c.id === id);

export interface ChannelRow { id: string; type: string; name: string; config: string; enabled: number; created_at: number }

export function channelSecrets(type: string) {
  return new Set((getChannelType(type)?.fields ?? []).filter((f) => f.type === 'secret').map((f) => f.key));
}
export function encodeChannelConfig(type: string, incoming: Record<string, any>, prevRaw?: string) {
  const secrets = channelSecrets(type);
  const prev = json<Record<string, any>>(prevRaw, {});
  const out: Record<string, any> = {};
  for (const f of getChannelType(type)?.fields ?? []) {
    const v = incoming[f.key];
    if (secrets.has(f.key)) {
      if (v === '__unchanged__') { if (prev[f.key]) out[f.key] = prev[f.key]; }
      else if (v) out[f.key] = encrypt(String(v));
    } else if (v !== undefined) out[f.key] = v;
  }
  return JSON.stringify(out);
}
export function publicChannel(r: ChannelRow) {
  const c = json<Record<string, any>>(r.config, {});
  for (const k of channelSecrets(r.type)) if (c[k]) c[k] = '__unchanged__';
  return { ...r, config: c, enabled: !!r.enabled };
}
function decryptConfig(raw: string) {
  const c = json<Record<string, any>>(raw, {});
  for (const k of Object.keys(c)) if (isEncrypted(c[k])) c[k] = decrypt(c[k]);
  return c;
}

export async function sendTo(channelIds: string[] | 'all', n: Notification) {
  const rows = q.all<ChannelRow>('SELECT * FROM channels WHERE enabled = 1');
  const targets = channelIds === 'all' ? rows : rows.filter((r) => channelIds.includes(r.id));
  await Promise.all(
    targets.map(async (r) => {
      const t = getChannelType(r.type);
      if (!t) return;
      try {
        await t.send(decryptConfig(r.config), n);
      } catch (e: any) {
        console.error(`[alerts] channel ${r.name} failed:`, e?.message ?? e);
      }
    }),
  );
}

export async function testChannel(r: ChannelRow) {
  const t = getChannelType(r.type);
  if (!t) throw new Error('Nepoznat kanal');
  await t.send(decryptConfig(r.config), { title: 'Test obavijest', message: 'SCYDE Hub kanal radi.', severity: 'info' });
}
