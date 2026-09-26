import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from './db';
import worker from '../src/index';
import { classifyNext, deliver } from '../src/pipeline';
import { deliverDiscord } from '../src/discord-delivery';
import * as discord from '../src/discord';
import { BOT_PERMISSIONS, BOT_SETUP_PERMISSIONS, CHANNEL_MANAGER_PERMISSIONS, MEMBER_POST_PERMISSIONS, discordNews, hasPermissions, MANAGE_CHANNELS } from '../src/discord';
import { handleDiscordInteraction, type DiscordInteraction } from '../src/discord-interactions';
import type { Env } from '../src/types';

const STAMP = 1_800_000_000_000;
const CHANNEL = '1234567890123456789', GUILD = '2234567890123456789', USER = '3234567890123456789';
const APPLICATION = '4234567890123456789', MESSAGE = '5234567890123456789', OTHER = '6234567890123456789';
let database: ReturnType<typeof testDatabase>, env: Env, sequence: bigint;
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const row = (table: string) => database.sql.prepare(`SELECT * FROM ${table}`).get() as any;
const count = (table: string) => database.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n;
const command = (name: string, extra: Partial<DiscordInteraction> = {}): DiscordInteraction => ({
  id: String(sequence++), application_id: APPLICATION, type: 2, guild_id: GUILD, channel_id: CHANNEL,
  channel: { id: CHANNEL, type: 0 }, member: { user: { id: USER }, permissions: String(CHANNEL_MANAGER_PERMISSIONS) },
  app_permissions: String(BOT_SETUP_PERMISSIONS), data: { name }, ...extra,
});
async function menu() {
  const i = command('categorias');
  const response = await handleDiscordInteraction(env, i);
  return { i, response, customId: `categorias:${i.id}` };
}
const select = (customId: string, values: string[], extra: Partial<DiscordInteraction> = {}) =>
  command('', { type: 3, data: { component_type: 3, custom_id: customId, values }, ...extra });
async function configure(values = ['1']) {
  const m = await menu();
  return handleDiscordInteraction(env, select(m.customId, values));
}
function channel(id = CHANNEL, cutoff = STAMP - 1) {
  database.sql.prepare('INSERT INTO discord_channels(id,guild_id,created_at,updated_at) VALUES(?,?,?,?)').run(id,GUILD,cutoff,cutoff);
  database.sql.prepare('INSERT INTO discord_subscriptions VALUES(?,1,?),(?,2,?)').run(id,cutoff,id,cutoff);
}
function article(id = 'news', captured = STAMP) {
  const categories = database.sql.prepare('SELECT * FROM categories').all();
  database.sql.prepare(`INSERT INTO articles(id,guid,url,title,summary,source_name,captured_at,categories,status)
    VALUES(?,?,?,?,?,?,?,?, 'pending')`).run(id,id,`https://www.ifnmg.edu.br/${id}`,'Título da notícia','Resumo da notícia','Fonte IFNMG',captured,JSON.stringify(categories));
}
async function classifyArticles() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json({ model: 'test',
    answers: { cat_1: { type: 'noul', noul: 0.9 }, cat_2: { type: 'noul', noul: 0.8 } } }))));
  await classifyNext(env);
}
async function queue(twoChannels = false) {
  channel(); if (twoChannels) channel(OTHER);
  article(); await classifyArticles();
}
beforeEach(() => {
  vi.spyOn(discord, 'makeDiscordChannelReadOnly').mockResolvedValue(undefined);
  database = testDatabase(); sequence = 7234567890123456700n;
  env = { DB: database.db, TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_ADMIN_ID: '1', TELEGRAM_WEBHOOK_SECRET: 'secret',
    TASK_SECRET: 'task', TYPESAFE_API_KEY: 'fake', APP_URL: 'https://example.com', JEV_MODEL: 'test', MATCH_THRESHOLD: '0.65',
    DISCORD_APPLICATION_ID: APPLICATION, DISCORD_BOT_TOKEN: 'fake-discord' };
  vi.spyOn(Date, 'now').mockReturnValue(STAMP);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request in test')));
  database.sql.exec(`INSERT INTO categories(id,name,description,created_at) VALUES
    (1,'Bolsas','Bolsas para estudantes',1),(2,'Pesquisa','Oportunidades de pesquisa',1);
    INSERT INTO users(id,created_at) VALUES(1,1);
    INSERT INTO subscriptions VALUES(1,1,1),(1,2,1);`);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); database.sql.close(); });

describe('Discord configuration and permissions', () => {
  it('uses Portuguese commands restricted to servers, with default manager permissions for mutations', () => {
    const commands = JSON.parse(readFileSync(new URL('../assets/discord-commands.json', import.meta.url),'utf8'));
    expect(commands.map((c: any) => c.name)).toEqual(['categorias','configuracao','pausar','retomar']);
    for (const c of commands) {
      expect(c.contexts).toEqual([0]); expect(c.integration_types).toEqual([0]);
      if (c.name !== 'configuracao') expect(c.default_member_permissions).toBe(c.name === 'pausar' ? '16' : String(CHANNEL_MANAGER_PERMISSIONS));
    }
  });
  it('offers active categories without exposing classification criteria and stores snowflakes as TEXT', async () => {
    const { response, customId } = await menu();
    expect(response.data.flags).toBe(64);
    const component = (response.data.components[0] as any).components[0];
    expect(component.min_values).toBe(0); expect(component.max_values).toBe(1);
    expect(component.options.map((o: any) => o.label)).toEqual(['Bolsas','Pesquisa']);
    expect(JSON.stringify(component)).not.toContain('Bolsas para estudantes');
    await handleDiscordInteraction(env, select(customId, ['1']));
    expect(row('discord_channels')).toMatchObject({ id: CHANNEL, guild_id: GUILD, active: 1 });
    expect(count('discord_subscriptions')).toBe(1);
    expect(database.sql.prepare('SELECT typeof(id) kind FROM discord_channels').get()!.kind).toBe('text');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('protects commands and crafted selections even when Discord command defaults are overridden', async () => {
    const { customId } = await menu();
    const member = { user: { id: USER }, permissions: '0' };
    for (const name of ['categorias','pausar','retomar']) {
      expect((await handleDiscordInteraction(env, command(name,{ member }))).data.content).toContain('Gerenciar canal');
    }
    expect((await handleDiscordInteraction(env, select(customId,['1'],{ member }))).data.content).toContain('Gerenciar canal');
    expect(count('discord_channels')).toBe(0);
    expect((await handleDiscordInteraction(env, command('configuracao',{ member }))).data.content).toContain('ainda não');
    expect(hasPermissions(String((1n << 60n) | 16n), MANAGE_CHANNELS)).toBe(true);
    expect(hasPermissions('8', BOT_PERMISSIONS)).toBe(true);
    expect(hasPermissions('invalid', MANAGE_CHANNELS)).toBe(false);
  });
  it('requires Manage Roles before allowing a manager to change channel permissions', async () => {
    const { customId } = await menu();
    const member = { user: { id: USER }, permissions: '16' };
    for (const i of [command('categorias', { member }), command('retomar', { member }), select(customId, ['1'], { member })]) {
      expect((await handleDiscordInteraction(env, i)).data.content).toContain('Gerenciar cargos');
    }
    expect(discord.makeDiscordChannelReadOnly).not.toHaveBeenCalled();
  });
  it('keeps subscriptions and menu usable when permission updates fail, then reapplies restrictions on resume', async () => {
    await configure(['1']);
    const { customId } = await menu();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(discord.makeDiscordChannelReadOnly).mockRejectedValueOnce(new discord.DiscordError(403));
    const submission = select(customId, ['2']);
    expect((await handleDiscordInteraction(env, submission)).data.content).toContain('não foi alterada');
    expect(row('discord_subscriptions').category_id).toBe(1);
    expect((await handleDiscordInteraction(env, submission)).data.content).toContain('Categoria salva');
    expect(row('discord_subscriptions').category_id).toBe(2);
    await handleDiscordInteraction(env, command('pausar'));
    vi.mocked(discord.makeDiscordChannelReadOnly).mockRejectedValueOnce(new discord.DiscordError(429));
    expect((await handleDiscordInteraction(env, command('retomar'))).data.content).toContain('não foi alterada');
    expect(row('discord_channels').active).toBe(0);
    await handleDiscordInteraction(env, command('retomar'));
    expect(row('discord_channels').active).toBe(1);
    expect(discord.makeDiscordChannelReadOnly).toHaveBeenLastCalledWith(env, GUILD, CHANNEL);
  });
  it('requires legacy multi-category channels to choose one category before resuming', async () => {
    channel();
    const { response } = await menu();
    const component = (response.data.components[0] as any).components[0];
    expect(component.options.every((o: any) => !o.default)).toBe(true);
    expect((await handleDiscordInteraction(env, command('retomar'))).data.content).toContain('uma única categoria');
    expect(discord.makeDiscordChannelReadOnly).not.toHaveBeenCalled();
  });
  it.each([1n << 10n, 1n << 11n, 1n << 14n, 1n << 4n, 1n << 28n, 1n << 35n, 1n << 36n, 1n << 38n])('requires each bot permission (%s), including on selection and resume', async missing => {
    await configure(); const { customId } = await menu();
    const app_permissions = String(BOT_SETUP_PERMISSIONS & ~missing);
    for (const i of [command('categorias',{ app_permissions }), command('retomar',{ app_permissions }), select(customId,['1'],{ app_permissions })]) {
      expect((await handleDiscordInteraction(env,i)).data.content).toContain('Ver canal');
    }
    expect(count('discord_subscriptions')).toBe(1);
    expect((await handleDiscordInteraction(env,command('pausar',{ app_permissions }))).data.content).toContain('pausados');
  });
  it('rejects private messages, unsupported channels, numeric IDs and foreign guilds', async () => {
    for (const i of [command('categorias',{ guild_id: undefined }), command('categorias',{ channel: { id: CHANNEL, type: 11 } }),
      command('categorias',{ channel_id: Number(CHANNEL) as unknown as string }), command('categorias',{ member: undefined })]) {
      await handleDiscordInteraction(env,i);
    }
    expect(count('discord_channels')).toBe(0); expect(count('discord_menus')).toBe(0);
    channel();
    expect((await handleDiscordInteraction(env,command('pausar',{ guild_id: OTHER }))).data.content).toContain('inválido');
    expect(row('discord_channels').active).toBe(1);
  });
  it('rejects expired, reused, cross-channel and cross-user menus and stale/forged category values', async () => {
    const { customId } = await menu();
    for (const values of [['999'],['1','1'],['1','2'],['01']]) {
      expect((await handleDiscordInteraction(env,select(customId,values))).data.content).toContain('inválida');
    }
    expect((await handleDiscordInteraction(env,select(customId,['1'], { member: { user: { id: OTHER }, permissions: String(CHANNEL_MANAGER_PERMISSIONS) } }))).data.content).toContain('expirou');
    expect((await handleDiscordInteraction(env,select(customId,['1'], { channel_id: OTHER, channel: { id: OTHER, type: 0 } }))).data.content).toContain('expirou');
    database.sql.exec('UPDATE categories SET active=0 WHERE id=2');
    expect((await handleDiscordInteraction(env,select(customId,['2']))).data.content).toContain('inválida');
    vi.mocked(Date.now).mockReturnValue(STAMP+16*60_000);
    expect((await handleDiscordInteraction(env,select(customId,['1']))).data.content).toContain('expirou');
    expect(count('discord_channels')).toBe(0);
  });
  it('replaces selections, clears all categories, and never resets cutoffs on replay', async () => {
    const { customId } = await menu(); const submission = select(customId,['1']);
    const first = await handleDiscordInteraction(env,submission);
    vi.mocked(Date.now).mockReturnValue(STAMP+10_000);
    expect(await handleDiscordInteraction(env,submission)).toEqual(first);
    expect(row('discord_subscriptions').created_at).toBe(STAMP);
    expect((await handleDiscordInteraction(env,select(customId,['1']))).data.content).toContain('já foi usado');
    await configure(['2']); expect(count('discord_subscriptions')).toBe(1);
    expect(row('discord_subscriptions').category_id).toBe(2);
    const status = await handleDiscordInteraction(env,command('configuracao'));
    expect(status.data.content).toContain('Pesquisa'); expect(status.data.content).not.toContain('Bolsas');
    await configure([]); expect(count('discord_subscriptions')).toBe(0);
    expect(count('subscriptions')).toBe(2);
  });
  it('preserves each interaction response when other commands and channels are configured', async () => {
    const original = await menu();
    await handleDiscordInteraction(env,select(original.customId,['1']));
    await handleDiscordInteraction(env,command('configuracao'));
    expect(await handleDiscordInteraction(env,original.i)).toEqual(original.response);
    const other = command('categorias',{ channel_id: OTHER, channel: { id: OTHER, type: 0 } });
    await handleDiscordInteraction(env,other);
    expect(await handleDiscordInteraction(env,original.i)).toEqual(original.response);
    expect(count('discord_menus')).toBe(2);
  });
  it('chooses one of twenty categories using a new menu and preserves the selection on replay', async () => {
    for (let id=3; id<=20; id++) {
      database.sql.prepare('INSERT INTO categories(id,name,description,created_at) VALUES(?,?,?,1)').run(id,`Categoria ${id}`,'Critérios '.repeat(300));
    }
    await configure(['1']);
    const fresh = await menu();
    const submission = select(fresh.customId,['20']);
    const result = await handleDiscordInteraction(env,submission);
    expect(result.data.content).toContain('Categoria salva');
    expect(count('discord_subscriptions')).toBe(1);
    expect(row('discord_subscriptions').category_id).toBe(20);
    vi.mocked(Date.now).mockReturnValue(STAMP+1000);
    expect(await handleDiscordInteraction(env,submission)).toEqual(result);
    expect(row('discord_subscriptions').created_at).toBe(STAMP);
  });
  it('pauses and resumes preserving categories, clears blocking and excludes already collected news', async () => {
    await queue();
    await handleDiscordInteraction(env,command('pausar'));
    expect(row('discord_channels').active).toBe(0); expect(row('discord_deliveries').status).toBe('cancelled');
    expect(count('discord_subscriptions')).toBe(2);
    article('while-paused',STAMP+1);
    await configure(['1']); expect(row('discord_channels').active).toBe(0);
    database.sql.exec("UPDATE discord_channels SET blocked=1,last_error='DiscordHTTP403'");
    vi.mocked(Date.now).mockReturnValue(STAMP+100);
    const resume = command('retomar');
    await handleDiscordInteraction(env,resume);
    expect(row('discord_channels')).toMatchObject({ active: 1, blocked: 0, last_error: null });
    expect(row('discord_subscriptions').created_at).toBe(STAMP+100);
    vi.mocked(Date.now).mockReturnValue(STAMP+200);
    await handleDiscordInteraction(env,resume); expect(row('discord_subscriptions').created_at).toBe(STAMP+100);
    await classifyArticles(); expect(count('discord_deliveries')).toBe(1);
    article('after-resume',STAMP+101); await classifyArticles();
    expect(count('discord_deliveries')).toBe(2);
  });
  it('initial configuration excludes news collected before the category selection', async () => {
    article('old', STAMP-1); await configure(); await classifyArticles();
    expect(count('discord_deliveries')).toBe(0); expect(count('deliveries')).toBe(1);
    article('new',STAMP+1); await classifyArticles(); expect(count('discord_deliveries')).toBe(1);
  });
});

describe('Discord read-only channel API', () => {
  it('removes posting grants from roles and members, preserves visibility and keeps the bot able to publish', async () => {
    vi.mocked(discord.makeDiscordChannelReadOnly).mockRestore();
    const view = 1n << 10n, history = 1n << 16n;
    const existing = [
      { id: GUILD, type: 0, allow: String(history), deny: String(view) },
      { id: OTHER, type: 0, allow: String(MEMBER_POST_PERMISSIONS | view), deny: '0' },
      { id: USER, type: 1, allow: String(MEMBER_POST_PERMISSIONS), deny: String(history) },
      { id: APPLICATION, type: 1, allow: '0', deny: String(MEMBER_POST_PERMISSIONS) },
    ];
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ id: CHANNEL, guild_id: GUILD, type: 0, permission_overwrites: existing }))
      .mockResolvedValueOnce(json({ id: APPLICATION, bot: true }))
      .mockResolvedValueOnce(json({ id: CHANNEL })));
    await discord.makeDiscordChannelReadOnly(env, GUILD, CHANNEL);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][1]!.method).toBe('GET'); expect(calls[0][1]!.body).toBeUndefined();
    expect(calls[2][1]!.method).toBe('PATCH');
    const overwrites = JSON.parse(calls[2][1]!.body as string).permission_overwrites;
    for (const o of overwrites.filter((o: any) => o.id !== APPLICATION)) {
      expect(BigInt(o.allow) & MEMBER_POST_PERMISSIONS).toBe(0n);
      expect(BigInt(o.deny) & MEMBER_POST_PERMISSIONS).toBe(MEMBER_POST_PERMISSIONS);
    }
    expect(BigInt(overwrites[0].deny) & view).toBe(view);
    expect(BigInt(overwrites[0].allow) & history).toBe(history);
    expect(BigInt(overwrites[1].allow) & view).toBe(view);
    expect(BigInt(overwrites[2].deny) & history).toBe(history);
    expect(BigInt(overwrites[3].allow) & (BOT_PERMISSIONS | MEMBER_POST_PERMISSIONS)).toBe(BOT_PERMISSIONS | MEMBER_POST_PERMISSIONS);
    expect(BigInt(overwrites[3].allow) & CHANNEL_MANAGER_PERMISSIONS).toBe(0n);
    expect(BigInt(overwrites[3].deny) & BOT_SETUP_PERMISSIONS).toBe(0n);
  });
  it('adds everyone and bot overwrites to a channel with no existing overrides', async () => {
    vi.mocked(discord.makeDiscordChannelReadOnly).mockRestore();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ id: CHANNEL, guild_id: GUILD, type: 5, permission_overwrites: [] }))
      .mockResolvedValueOnce(json({ id: APPLICATION, bot: true }))
      .mockResolvedValueOnce(json({ id: CHANNEL })));
    await discord.makeDiscordChannelReadOnly(env, GUILD, CHANNEL);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string).permission_overwrites).toEqual([
      { id: GUILD, type: 0, allow: '0', deny: String(MEMBER_POST_PERMISSIONS) },
      { id: APPLICATION, type: 1, allow: String(BOT_PERMISSIONS | MEMBER_POST_PERMISSIONS), deny: '0' },
    ]);
  });
  it.each([403,429,503])('propagates failed permission writes (HTTP %s)', async status => {
    vi.mocked(discord.makeDiscordChannelReadOnly).mockRestore();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ id: CHANNEL, guild_id: GUILD, type: 0, permission_overwrites: [] }))
      .mockResolvedValueOnce(json({ id: APPLICATION, bot: true }))
      .mockResolvedValueOnce(json({}, status)));
    await expect(discord.makeDiscordChannelReadOnly(env, GUILD, CHANNEL)).rejects.toMatchObject({ status });
  });
});

describe('Discord HTTP interaction authentication', () => {
  let keys: CryptoKeyPair, publicKey: string;
  beforeAll(async () => {
    keys = await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
    publicKey = Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
  });
  async function signed(payload: unknown, age = 0) {
    const body = JSON.stringify(payload), timestamp = String((STAMP+age)/1000);
    const sig = await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+body));
    return new Request('https://example.com/discord/interactions',{ method: 'POST', body,
      headers: { 'X-Signature-Ed25519': Buffer.from(sig).toString('hex'), 'X-Signature-Timestamp': timestamp } });
  }
  it('answers signed PINGs and rejects bad, altered, expired and wrong-application requests', async () => {
    env.DISCORD_PUBLIC_KEY = publicKey;
    const ping = { type: 1, application_id: APPLICATION };
    expect(await (await worker.fetch(await signed(ping),env)).json()).toEqual({ type: 1 });
    const signedRequest = await signed(ping);
    const altered = new Request(signedRequest.url,{ method: 'POST', headers: signedRequest.headers, body: JSON.stringify({ ...ping, type: 2 }) });
    for (const request of [altered, await signed(ping,-301_000), await signed({ ...ping, application_id: OTHER }),
      new Request(signedRequest.url,{ method: 'POST', body: '{}' })]) {
      expect((await worker.fetch(request,env)).status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled(); expect(count('discord_interactions')).toBe(0);
  });
  it('defers ephemerally and edits the original HTTP interaction response without a Gateway connection', async () => {
    env.DISCORD_PUBLIC_KEY = publicKey;
    const tasks: Promise<unknown>[] = [];
    const ctx = { waitUntil: (task: Promise<unknown>) => tasks.push(task) } as unknown as ExecutionContext;
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ id: MESSAGE })));
    const response = await worker.fetch(await signed({ ...command('categorias'), token: 'fake-interaction-token' }),env,ctx);
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    await Promise.all(tasks);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/messages/@original'); expect(options!.method).toBe('PATCH');
    expect(options!.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(options!.body as string).components).toHaveLength(1);
    expect(JSON.parse(options!.body as string)).not.toHaveProperty('flags');
  });
  it('protects the new internal route with the task secret', async () => {
    expect((await worker.fetch(new Request('https://example.com/internal/deliver-discord',{ method: 'POST' }),env)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([503,429])('retries the original response on HTTP %s without reapplying channel configuration', async status => {
    env.DISCORD_PUBLIC_KEY = publicKey;
    const fresh = await menu();
    const request = await signed({...select(fresh.customId,['1']),token:'fake-interaction-token'});
    const tasks: Promise<unknown>[] = [];
    vi.useFakeTimers({toFake:['setTimeout']});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json({retry_after:0.5},status)).mockImplementation(()=>{
      vi.mocked(Date.now).mockReturnValue(STAMP+1000);
      return Promise.resolve(json({id:MESSAGE}));
    }));
    expect((await worker.fetch(request,env,{waitUntil:(task:Promise<unknown>)=>tasks.push(task)} as unknown as ExecutionContext)).status).toBe(200);
    await vi.runAllTimersAsync();
    await Promise.all(tasks);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [first,second]=vi.mocked(fetch).mock.calls;
    expect(second[0]).toBe(first[0]); expect(second[1]!.body).toBe(first[1]!.body);
    expect(count('discord_subscriptions')).toBe(1);
    expect(row('discord_subscriptions').created_at).toBe(STAMP);
  });
  it.each([400,404,429,503])('bounds response retries for HTTP %s and retains the committed configuration', async status => {
    env.DISCORD_PUBLIC_KEY = publicKey;
    const fresh = await menu();
    const request=await signed({...select(fresh.customId,['2']),token:'fake-interaction-token'});
    const tasks: Promise<unknown>[]=[];
    vi.useFakeTimers({toFake:['setTimeout']});
    const logger=vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(json({retry_after:60},status))));
    await worker.fetch(request,env,{waitUntil:(task:Promise<unknown>)=>tasks.push(task)} as unknown as ExecutionContext);
    await vi.runAllTimersAsync();
    await Promise.all(tasks);
    expect(fetch).toHaveBeenCalledTimes(status===503?3:1);
    expect(row('discord_subscriptions').category_id).toBe(2);
    expect(logger).toHaveBeenCalledExactlyOnceWith(JSON.stringify({job:'discord-response',error:`DiscordHTTP${status}`}));
  });
});

describe('independent routing, deduplication and delivery failures', () => {
  it('classifies once for both platforms and sends one card per channel even with multiple matching categories', async () => {
    await queue(true); await classifyNext(env);
    expect(fetch).toHaveBeenCalledTimes(1); expect(count('matches')).toBe(2);
    expect(count('discord_deliveries')).toBe(2); expect(count('deliveries')).toBe(1);
    vi.stubGlobal('fetch',vi.fn().mockImplementation(() => Promise.resolve(json({ id: MESSAGE }))));
    await deliverDiscord(env); await deliverDiscord(env);
    expect(fetch).toHaveBeenCalledTimes(2);
    const bodies = vi.mocked(fetch).mock.calls.map(([,opts]) => JSON.parse(opts!.body as string));
    expect(bodies[0]).toMatchObject({ enforce_nonce: true, allowed_mentions: { parse: [] } });
    expect(bodies[0].nonce).toHaveLength(24); expect(bodies[0].nonce).not.toBe(bodies[1].nonce);
    expect(bodies[0].embeds[0]).toMatchObject({ title: 'Título da notícia', description: 'Resumo da notícia', url: 'https://www.ifnmg.edu.br/news' });
    expect(bodies[0].embeds[0].fields[0].value).toBe('Bolsas · Pesquisa');
    expect(row('discord_deliveries')).toMatchObject({ status: 'sent', message_id: MESSAGE });
    expect(row('deliveries').status).toBe('pending');
  });
  it('bounds cards and prevents feed/category content from generating mentions or Markdown links', () => {
    const card = discordNews({ title: '*'.repeat(500), summary: '[click](bad) '.repeat(1000), source_name: 'S'.repeat(600), url: 'https://www.ifnmg.edu.br/news' }, ['@everyone', 'C'.repeat(3000)]);
    const embed = card.embeds[0];
    expect(embed.title.length).toBeLessThanOrEqual(256); expect(embed.description.length).toBeLessThanOrEqual(3500);
    expect(embed.fields[0].value.length).toBeLessThanOrEqual(1024);
    expect(embed.description).toContain('\\[click\\]'); expect(card.allowed_mentions.parse).toEqual([]);
  });
  it('retries only the failed destination with the same nonce, independently of Telegram', async () => {
    await queue(true);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json({ id: MESSAGE })).mockResolvedValueOnce(json({},503)));
    await deliverDiscord(env);
    const failedBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(database.sql.prepare("SELECT COUNT(*) n FROM discord_deliveries WHERE status='pending'").get()!.n).toBe(1);
    expect(row('articles').attempts).toBe(1);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ ok: true, result: { message_id: 42 } })));
    await deliver(env); expect(row('deliveries').status).toBe('sent');
    vi.mocked(Date.now).mockReturnValue(STAMP+120_000);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ id: MESSAGE })));
    await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).nonce).toBe(failedBody.nonce);
  });
  it.each([403,404])('blocks only an unavailable channel on HTTP %s and continues other deliveries', async status => {
    await queue(true);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json({},status)).mockResolvedValueOnce(json({ id: MESSAGE })));
    await deliverDiscord(env);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(database.sql.prepare('SELECT blocked FROM discord_channels WHERE id=?').get(CHANNEL)!.blocked).toBe(1);
    expect(database.sql.prepare('SELECT status FROM discord_deliveries WHERE channel_id=?').get(CHANNEL)!.status).toBe('cancelled');
    expect(database.sql.prepare('SELECT status FROM discord_deliveries WHERE channel_id=?').get(OTHER)!.status).toBe('sent');
    article('next'); await classifyArticles();
    expect(database.sql.prepare('SELECT channel_id FROM discord_deliveries WHERE article_id=?').all('next')).toEqual([{ channel_id: OTHER }]);
  });
  it('respects fractional per-channel 429 backoff while other channels continue', async () => {
    await queue(true);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json({ retry_after: 120.5, global: false },429)).mockResolvedValueOnce(json({ id: MESSAGE })));
    await deliverDiscord(env); await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(2);
    expect(row('discord_channels').retry_at).toBe(STAMP+121_500);
    expect(row('discord_dispatch').retry_at).toBe(0);
    vi.mocked(Date.now).mockReturnValue(STAMP+122_000);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ id: MESSAGE })));
    await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([429,401])('stops the Discord batch on global HTTP %s without affecting Telegram', async status => {
    await queue(true);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ retry_after: 120, global: true },status)));
    await deliverDiscord(env); await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(1);
    expect(row('discord_dispatch').retry_at).toBeGreaterThan(STAMP);
    expect(database.sql.prepare("SELECT COUNT(*) n FROM discord_deliveries WHERE status='sending'").get()!.n).toBe(0);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ ok: true, result: { message_id: 42 } })));
    await deliver(env); expect(row('deliveries').status).toBe('sent');
  });
  it('honors successful-response rate limit headers across ticks', async () => {
    await queue(); article('second'); await classifyArticles();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ id: MESSAGE },200,{ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '120.5' })));
    await deliverDiscord(env); await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(STAMP+122_000);
    await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rechecks changed subscriptions and cancels queued messages before sending', async () => {
    await queue(true);
    vi.stubGlobal('fetch',vi.fn().mockImplementation(() => {
      database.sql.prepare('DELETE FROM discord_subscriptions WHERE channel_id=?').run(OTHER);
      return Promise.resolve(json({ id: MESSAGE }));
    }));
    await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(1);
    expect(database.sql.prepare('SELECT status FROM discord_deliveries WHERE channel_id=?').get(OTHER)!.status).toBe('cancelled');
  });
  it('cancels deactivated categories and excludes paused channels during classification', async () => {
    await queue(); database.sql.exec('UPDATE categories SET active=0');
    vi.stubGlobal('fetch',vi.fn()); await deliverDiscord(env); expect(fetch).not.toHaveBeenCalled();
    expect(row('discord_deliveries').status).toBe('cancelled');
    database.sql.exec('UPDATE categories SET active=1; UPDATE discord_channels SET active=0');
    article('paused'); await classifyArticles(); expect(count('discord_deliveries')).toBe(1);
  });
  it('recovers expired delivery leases and excludes concurrent dispatcher runs', async () => {
    await queue();
    database.sql.prepare("UPDATE discord_deliveries SET status='sending',lease_until=?,lease_token='old'").run(STAMP-1);
    database.sql.prepare('UPDATE discord_dispatch SET lease_until=?').run(STAMP+1);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({ id: MESSAGE })));
    expect(await deliverDiscord(env)).toEqual({ busy: true }); expect(fetch).not.toHaveBeenCalled();
    vi.mocked(Date.now).mockReturnValue(STAMP+2);
    await deliverDiscord(env); expect(fetch).toHaveBeenCalledTimes(1); expect(row('discord_deliveries').status).toBe('sent');
  });
  it.each(['network','invalid-json','bad-request'])('handles %s without reclassifying or exposing provider data', async failure => {
    await queue();
    const mock = vi.fn();
    if (failure === 'network') mock.mockRejectedValue(new Error('secret token in error'));
    else if (failure === 'invalid-json') mock.mockResolvedValue(new Response('private response'));
    else mock.mockResolvedValue(new Response('secret error body',{ status: 400 }));
    vi.stubGlobal('fetch',mock); await deliverDiscord(env);
    expect(row('discord_deliveries').status).toBe(failure === 'bad-request' ? 'failed' : 'pending');
    expect(row('discord_deliveries').last_error).toMatch(/^DiscordHTTP/);
    expect(row('articles').attempts).toBe(1);
  });
  it('does nothing when Discord is unconfigured and runs delivery stages independently in the scheduler', async () => {
    await queue(); delete env.DISCORD_BOT_TOKEN;
    vi.stubGlobal('fetch',vi.fn()); expect(await deliverDiscord(env)).toEqual({ disabled: true }); expect(fetch).not.toHaveBeenCalled();
    env.DISCORD_BOT_TOKEN = 'fake';
    const paths: string[] = [], tasks: Promise<unknown>[] = [];
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async (url, options) => {
      const path = new URL(url as string).pathname; paths.push(path);
      if (path === '/internal/deliver-discord') throw new Error('isolated Discord job failure');
      if (path.startsWith('/internal/')) return worker.fetch(new Request(url as string,options),env);
      return json({ ok: true, result: { message_id: 42 } });
    }));
    vi.spyOn(console,'error').mockImplementation(() => {});
    await worker.scheduled({ scheduledTime: 6*60_000 } as ScheduledController,env,
      { waitUntil: (task: Promise<unknown>) => tasks.push(task) } as unknown as ExecutionContext);
    await Promise.all(tasks);
    expect(paths).toContain('/internal/deliver-discord'); expect(row('deliveries').status).toBe('sent');
    expect(row('discord_deliveries').status).toBe('pending');
  });
});

it('migrates an existing database without losing Telegram users, subscriptions, pending deliveries or history', () => {
  const old = testDatabase('0002');
  try {
    old.sql.exec(`INSERT INTO categories(id,name,description,created_at) VALUES(1,'Bolsas','Critérios',1);
      INSERT INTO users(id,created_at) VALUES(42,1); INSERT INTO subscriptions VALUES(42,1,1);
      INSERT INTO articles(id,guid,url,title,summary,source_name,captured_at,categories,status)
      VALUES('a','a','https://www.ifnmg.edu.br/a','a','a','a',1,'[]','classified'),
      ('b','b','https://www.ifnmg.edu.br/b','b','b','b',1,'[]','pending');
      INSERT INTO matches VALUES('a',1,1,0.9,1);
      INSERT INTO deliveries(article_id,user_id,status,message_id) VALUES('a',42,'sent',123),('b',42,'pending',NULL);`);
    const tables = ['sources','categories','users','subscriptions','articles','matches','deliveries','settings'];
    const snapshot = tables.map(t => old.sql.prepare(`SELECT * FROM ${t}`).all());
    old.sql.exec(readFileSync(new URL('../migrations/0003_discord.sql',import.meta.url),'utf8'));
    expect(tables.map(t => old.sql.prepare(`SELECT * FROM ${t}`).all())).toEqual(snapshot);
    expect(old.sql.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(old.sql.prepare('SELECT COUNT(*) n FROM discord_deliveries').get()!.n).toBe(0);
  } finally { old.sql.close(); }
});
