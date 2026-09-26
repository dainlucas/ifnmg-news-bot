import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

const commands = JSON.parse(readFileSync(new URL('../assets/discord-commands.json', import.meta.url), 'utf8'));
const dryRun = process.argv.includes('--dry-run');
if (dryRun) {
  // Safe local validation: do not even load credentials or contact Discord.
  if (commands.length !== 4 || commands.some(c => !/^[a-z]{1,32}$/.test(c.name) || c.contexts[0] !== 0 || c.integration_types[0] !== 0)) {
    throw new Error('Invalid Discord commands');
  }
  console.log(JSON.stringify({ dryRun: true, commands }, null, 2));
} else {
  const varsFile = new URL('../.dev.vars', import.meta.url);
  if (existsSync(varsFile)) loadEnvFile(varsFile);
  let appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) {
    try { appId = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).vars.DISCORD_APPLICATION_ID; }
    catch { throw new Error('Set DISCORD_APPLICATION_ID in the environment or vars.DISCORD_APPLICATION_ID in wrangler.jsonc (JSON)'); }
  }
  const guildId = process.env.DISCORD_TEST_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (typeof appId !== 'string' || !/^[1-9]\d{0,19}$/.test(appId) || !botToken || (guildId && !/^[1-9]\d{0,19}$/.test(guildId))) {
    throw new Error('Configure DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN; optional DISCORD_TEST_GUILD_ID must be a string ID');
  }
  const path = `/applications/${appId}${guildId ? `/guilds/${guildId}` : ''}/commands`;
  // Guild registration does not accept global-command installation/context fields.
  const body = guildId ? commands.map(({ contexts, integration_types, ...command }) => ({ ...command, dm_permission: false })) : commands;
  let response;
  try {
    response = await fetch(`https://discord.com/api/v10${path}`, {
      method: 'PUT', headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error('Discord connection failed'); }
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Discord command registration: HTTP ${response.status}; retry later if rate limited`);
  console.log(`Registered ${commands.length} commands (${guildId ? 'test server' : 'global'}).`);
}
