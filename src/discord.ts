import { hashText, readLimited } from './feed';
import type { Article, Env } from './types';

export const DISCORD_API = 'https://discord.com/api/v10';
export const MANAGE_CHANNELS = 1n << 4n;
export const BOT_PERMISSIONS = (1n << 10n) | (1n << 11n) | (1n << 14n);
export const MANAGE_ROLES = 1n << 28n;
export const CHANNEL_MANAGER_PERMISSIONS = MANAGE_CHANNELS | MANAGE_ROLES;
// Sending in threads is independent of sending in the parent channel.
export const MEMBER_POST_PERMISSIONS = (1n << 11n) | (1n << 35n) | (1n << 36n) | (1n << 38n);
export const BOT_SETUP_PERMISSIONS = BOT_PERMISSIONS | CHANNEL_MANAGER_PERMISSIONS | MEMBER_POST_PERMISSIONS;
export const snowflake = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
export function hasPermissions(value: unknown, required: bigint): boolean {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return false;
  const bits = BigInt(value);
  return (bits & 8n) !== 0n || (bits & required) === required;
}

export class DiscordError extends Error {
  constructor(public status: number, public retryAfter = 0, public global = false) {
    super('Discord request failed');
    this.name = `DiscordHTTP${status}`;
  }
}

const seconds = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Error bodies and URLs may contain provider/private data; only retain status codes.
export async function discordRequest(env: Env, path: string, body: unknown, method = 'POST', webhook = false, timeoutMs = 12_000) {
  let response: Response;
  try {
    response = await fetch(`${DISCORD_API}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(!webhook ? { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new DiscordError(0); }
  let data: any;
  try { data = JSON.parse(await readLimited(response, 100_000)); }
  catch { if (response.ok) throw new DiscordError(0); }
  const retryAfter = Math.max(seconds(data?.retry_after), seconds(response.headers.get('Retry-After')),
    seconds(response.headers.get('X-RateLimit-Reset-After')));
  if (!response.ok) throw new DiscordError(response.status, retryAfter,
    data?.global === true || response.headers.get('X-RateLimit-Global') === 'true' || response.headers.get('X-RateLimit-Scope') === 'global');
  return { data, retryAfter: response.headers.get('X-RateLimit-Remaining') === '0' ? retryAfter : 0 };
}

interface Overwrite { id: string; type: number; allow: string; deny: string }

export async function makeDiscordChannelReadOnly(env: Env, guild: string, channel: string) {
  // Read current overwrites so private-channel visibility and unrelated permissions survive.
  const { data: current } = await discordRequest(env, `/channels/${channel}`, undefined, 'GET', false, 5000);
  if (current?.id !== channel || current.guild_id !== guild || ![0,5].includes(current.type) ||
    !Array.isArray(current.permission_overwrites)) throw new DiscordError(0);
  const { data: bot } = await discordRequest(env, '/users/@me', undefined, 'GET', false, 5000);
  if (!snowflake(bot?.id) || bot.bot !== true) throw new DiscordError(0);
  const overwrites: Overwrite[] = current.permission_overwrites.map((entry: Overwrite) => {
    if (!snowflake(entry.id) || ![0,1].includes(entry.type) ||
      typeof entry.allow !== 'string' || !/^\d+$/.test(entry.allow) ||
      typeof entry.deny !== 'string' || !/^\d+$/.test(entry.deny)) throw new DiscordError(0);
    return { id: entry.id, type: entry.type, allow: entry.allow, deny: entry.deny };
  });
  if (!overwrites.some(o => o.id === guild && o.type === 0)) {
    overwrites.push({ id: guild, type: 0, allow: '0', deny: '0' });
  }
  if (!overwrites.some(o => o.id === bot.id && o.type === 1)) {
    overwrites.push({ id: bot.id, type: 1, allow: '0', deny: '0' });
  }
  for (const overwrite of overwrites) {
    const isBot = overwrite.id === bot.id && overwrite.type === 1;
    // Management permissions come from the bot's server role. Do not grant them
    // through channel overwrites, which Discord can restrict to administrators.
    const botChannelPermissions = BOT_PERMISSIONS | MEMBER_POST_PERMISSIONS;
    // Role/member allows override an @everyone deny, so restrict every existing override.
    overwrite.allow = String(isBot ? BigInt(overwrite.allow) | botChannelPermissions
      : BigInt(overwrite.allow) & ~MEMBER_POST_PERMISSIONS);
    overwrite.deny = String(isBot ? BigInt(overwrite.deny) & ~botChannelPermissions
      : BigInt(overwrite.deny) | MEMBER_POST_PERMISSIONS);
  }
  // One atomic channel update avoids locking the bot out between permission edits.
  await discordRequest(env, `/channels/${channel}`, { permission_overwrites: overwrites }, 'PATCH', false, 5000);
}

// Escape feed/category Markdown and bound the complete embed well below 6000 characters.
const text = (value: string, limit: number) => value.replace(/[\\*_~`|>\[\]]/g, '\\$&').slice(0, limit).replace(/\\$/, '');
export function discordNews(article: Pick<Article, 'title' | 'summary' | 'url' | 'source_name'>, names: string[]) {
  const link = `[Ler no IFNMG](<${article.url}>)`;
  return {
    allowed_mentions: { parse: [] },
    embeds: [{ title: text(article.title, 256), description: text(article.summary, 3500) || 'Leia a publicação original.',
      url: article.url, color: 0x27833f,
      fields: [
        { name: 'Categorias', value: text(names.join(' · '), 1024) || 'Sem categoria' },
        { name: 'Fonte', value: text(article.source_name, 200) || 'IFNMG' },
        { name: 'Publicação original', value: link.length <= 1024 ? link : 'Acesse pelo título deste cartão.' },
      ],
    }],
  };
}

export async function sendDiscordNews(env: Env, channel: string, article: Article, names: string[]) {
  // Nonces are unique across destinations as well as articles and fit Discord's 25-char limit.
  const nonce = (await hashText(`${channel}:${article.id}`)).slice(0, 24);
  const result = await discordRequest(env, `/channels/${channel}/messages`, {
    ...discordNews(article, names), nonce, enforce_nonce: true,
  });
  if (!snowflake(result.data?.id)) throw new DiscordError(0);
  return { messageId: result.data.id as string, retryAfter: result.retryAfter };
}
