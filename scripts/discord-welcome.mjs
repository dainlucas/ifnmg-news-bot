import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

const template = JSON.parse(readFileSync(new URL('../assets/discord-welcome.json', import.meta.url), 'utf8'));
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(template, null, 2));
  process.exit(0);
}
const varsFile = new URL('../.dev.vars', import.meta.url);
if (existsSync(varsFile)) loadEnvFile(varsFile);
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const token = process.env.DISCORD_BOT_TOKEN;
if (!token || !process.env.TASK_SECRET) throw new Error('Missing bot or task credentials');
async function api(path, body, method = 'GET') {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('Discord connection failed'); }
    const data = await response.json().catch(() => null);
    if (response.status === 429 && attempt < 3 && Number(data?.retry_after) <= 30) {
      await new Promise(resolve => setTimeout(resolve, Math.max(1000, Number(data.retry_after) * 1000 + 200)));
      continue;
    }
    if (!response.ok) throw new Error(`Discord request: HTTP ${response.status}`);
    return data;
  }
}
const guilds = await api('/users/@me/guilds');
const guildId = process.env.DISCORD_GUILD_ID || (guilds.length === 1 ? guilds[0].id : undefined);
if (!guildId || !guilds.some(g => g.id === guildId)) throw new Error('Set DISCORD_GUILD_ID to the target server ID');
const bot = await api('/users/@me');
const channels = await api(`/guilds/${guildId}/channels`);
const statusResponse = await fetch(`${config.vars.APP_URL}/internal/status`, {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.TASK_SECRET}` }, signal: AbortSignal.timeout(15000),
});
if (!statusResponse.ok) throw new Error(`Status request: HTTP ${statusResponse.status}`);
const { categories } = await statusResponse.json();
const slug = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,100);
const links = categories.filter(c => c.active).sort((a,b) => a.id - b.id).map(category => {
  const matches = channels.filter(c => [0,5].includes(c.type) && c.name === slug(category.name));
  if (matches.length !== 1) throw new Error(`Expected one channel for category ${category.id}`);
  return `• <#${matches[0].id}>`;
}).join('\n');
const embed = structuredClone(template);
for (const field of embed.fields) field.value = field.value.replace('{{category_channels}}', links);
if (embed.fields.some(f => f.value.length > 1024) || embed.description.length > 4096 ||
  embed.title.length + embed.description.length + embed.footer.text.length + embed.fields.reduce((sum,f) => sum + f.name.length + f.value.length, 0) > 6000) throw new Error('Welcome exceeds Discord embed limits');
const posting = (1n << 11n) | (1n << 35n) | (1n << 36n) | (1n << 38n);
const reading = (1n << 10n) | (1n << 16n);
const existing = channels.filter(c => c.type === 0 && c.name === 'boas-vindas');
if (existing.length > 1) throw new Error('Multiple welcome channels found');
if (existing.length && existing[0].permission_overwrites.some(o => o.id !== guildId && !(o.id === bot.id && o.type === 1))) {
  throw new Error('Review existing welcome channel permission overrides before updating');
}
const channelBody = {
  name: 'boas-vindas', type: 0, parent_id: null, position: 0,
  topic: 'Comece aqui: conheça os assuntos, escolha suas notificações e entenda como acompanhar as notícias do IFNMG.',
  permission_overwrites: [
    { id: guildId, type: 0, allow: String(reading), deny: String(posting) },
    { id: bot.id, type: 1, allow: String(reading | posting | (1n << 14n)), deny: '0' },
  ],
};
const channel = existing[0]
  ? await api(`/channels/${existing[0].id}`, channelBody, 'PATCH')
  : await api(`/guilds/${guildId}/channels`, channelBody, 'POST');
const messages = await api(`/channels/${channel.id}/messages?limit=100`);
const previous = messages.filter(m => m.author.id === bot.id && m.embeds?.some(e => e.title === template.title));
if (previous.length > 1) throw new Error('Multiple welcome messages found');
const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
const message = previous[0]
  ? await api(`/channels/${channel.id}/messages/${previous[0].id}`, payload, 'PATCH')
  : await api(`/channels/${channel.id}/messages`, { ...payload, nonce: 'ifnmg-welcome-v1', enforce_nonce: true }, 'POST');
const saved = await api(`/channels/${channel.id}/messages/${message.id}`);
if (saved.embeds?.[0]?.title !== embed.title || saved.embeds[0].fields?.[1]?.value !== links) throw new Error('Welcome verification failed');
console.log(`Welcome published: https://discord.com/channels/${guildId}/${channel.id}/${message.id}`);
