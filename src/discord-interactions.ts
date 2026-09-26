import { BOT_SETUP_PERMISSIONS, CHANNEL_MANAGER_PERMISSIONS, MANAGE_CHANNELS, DiscordError, discordRequest, hasPermissions, makeDiscordChannelReadOnly, snowflake } from './discord';
import { readLimited } from './feed';
import { errorCode, now, statement as q, type Category, type Env } from './types';

export interface DiscordInteraction {
  id: string; application_id: string; type: number; token?: string;
  guild_id?: string; channel_id?: string; channel?: { id: string; type: number };
  member?: { user?: { id: string; bot?: boolean }; permissions?: string };
  app_permissions?: string;
  data?: { name?: string; custom_id?: string; component_type?: number; values?: string[] };
}
interface Channel { id: string; guild_id: string; active: number; blocked: number; last_error: string | null }
interface Menu { guild_id: string; channel_id: string; user_id: string; category_ids: string; expires_at: number; used_at: number | null }
type Reply = { type: 4; data: { content: string; flags: number; allowed_mentions: { parse: never[] }; components: unknown[] } };
const reply = (content: string, components: unknown[] = []): Reply => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] }, components } });

export async function handleDiscordInteraction(env: Env, interaction: DiscordInteraction): Promise<Reply> {
  const i = interaction, stamp = now();
  if (!snowflake(i.id) || i.application_id !== env.DISCORD_APPLICATION_ID) return reply('Interação inválida.');
  if (!snowflake(i.guild_id) || !snowflake(i.channel_id) || !snowflake(i.member?.user?.id) || i.member?.user?.bot) {
    return reply('Use os comandos em um canal de servidor. Não há inscrições ou entregas por mensagem privada.');
  }
  if (!i.channel || i.channel.id !== i.channel_id || ![0,5].includes(i.channel.type)) {
    return reply('Use um canal de texto ou de anúncios do servidor. Fóruns e tópicos não são suportados nesta versão.');
  }
  const command = i.type === 2 ? i.data?.name : undefined;
  const selecting = i.type === 3 && i.data?.component_type === 3 && i.data.custom_id?.startsWith('categorias:');
  if (!selecting && !['categorias','configuracao','pausar','retomar'].includes(command ?? '')) return reply('Comando desconhecido.');
  if (command !== 'configuracao' && !hasPermissions(i.member.permissions, MANAGE_CHANNELS)) {
    return reply('Você precisa da permissão Gerenciar canal para alterar esta configuração.');
  }
  if (command !== 'configuracao' && command !== 'pausar' && !hasPermissions(i.member.permissions, CHANNEL_MANAGER_PERMISSIONS)) {
    return reply('Você precisa das permissões Gerenciar canal e Gerenciar cargos para configurar um canal somente de leitura.');
  }
  if (command !== 'configuracao' && command !== 'pausar' && (!env.DISCORD_BOT_TOKEN || !hasPermissions(i.app_permissions, BOT_SETUP_PERMISSIONS))) {
    return reply('O bot precisa das permissões Ver canal, Enviar mensagens, Inserir links, Gerenciar canais, Gerenciar cargos, Criar tópicos públicos e privados e Enviar mensagens em tópicos para configurar o canal somente de leitura.');
  }
  // One database round trip, without the large JEV descriptions that menus never use.
  const [previousRows, channelRows, categoryRows, subscriptionRows] = await env.DB.batch([
    q(env.DB, 'SELECT response FROM discord_interactions WHERE id=?', i.id),
    q(env.DB, 'SELECT id,guild_id,active,blocked,last_error FROM discord_channels WHERE id=?', i.channel_id),
    q(env.DB, 'SELECT id,name,active FROM categories ORDER BY id'),
    q(env.DB, 'SELECT category_id FROM discord_subscriptions WHERE channel_id=?', i.channel_id),
  ]);
  const previous = previousRows.results[0] as { response: string } | undefined;
  if (previous) return JSON.parse(previous.response);
  const channel = channelRows.results[0] as Channel | undefined;
  if (channel && channel.guild_id !== i.guild_id) return reply('Canal inválido para este servidor.');
  const categories = categoryRows.results as Pick<Category, 'id' | 'name' | 'active'>[];
  const active = categories.filter(c => c.active);
  const selected = (subscriptionRows.results as { category_id: number }[]).map(s => s.category_id);
  const token = crypto.randomUUID(); // Internal idempotency ownership token, never a Discord credential.
  const jobs: D1PreparedStatement[] = [];
  let guard = 'EXISTS(SELECT 1 FROM discord_interactions WHERE id=? AND token=?)';
  let guardArgs: (string | number)[] = [i.id, token];
  const mutate = (sql: string, ...values: (string | number | null)[]) => jobs.push(q(env.DB, `${sql} AND ${guard}`, ...values, ...guardArgs));
  let sessionId: string | undefined;
  let result: Reply;
  if (command === 'configuracao') {
    const names = categories.filter(c => selected.includes(c.id)).map(c => `• ${c.name}${c.active ? '' : ' (desativada)'}`);
    result = reply(!channel ? 'Este canal ainda não foi configurado. Use /categorias.' :
      `Canal: <#${i.channel_id}>\n${channel.blocked ? 'Envios bloqueados: verifique se o canal existe e as permissões do bot; depois use /retomar.' : channel.active ? 'Envios ativos.' : 'Envios pausados.'}\n\n${names.join('\n') || 'Nenhuma categoria selecionada.'}`);
  } else if (command === 'categorias') {
    if (!active.length) return reply('Ainda não há categorias disponíveis. O administrador do projeto pode cadastrá-las no Telegram.');
    if (active.length > 25) return reply('Há mais categorias do que este menu suporta. Contate o administrador do projeto.');
    mutate(`INSERT INTO discord_menus(id,guild_id,channel_id,user_id,category_ids,expires_at)
      SELECT ?,?,?,?,?,? WHERE 1`, i.id, i.guild_id, i.channel_id, i.member.user!.id, JSON.stringify(active.map(c => String(c.id))), stamp + 15 * 60_000);
    result = reply('Escolha uma categoria para este canal. Ao salvar, membros poderão apenas ler: somente o bot publicará notícias, sem conversas ou tópicos. Use um canal por categoria; cada pessoa pode silenciar os que não quiser acompanhar. A seleção vale para notícias novas. Limpe a seleção para desativar os envios.',
      [{ type: 1, components: [{ type: 3, custom_id: `categorias:${i.id}`, placeholder: 'Categoria do canal',
        min_values: 0, max_values: 1,
        options: active.map(c => ({ label: c.name.slice(0,100), value: String(c.id), default: selected.length === 1 && selected.includes(c.id) })),
      }] }]);
  } else if (selecting) {
    sessionId = i.data!.custom_id!.slice('categorias:'.length);
    const menu = await q(env.DB, 'SELECT * FROM discord_menus WHERE id=?', sessionId).first<Menu>();
    if (!menu || menu.expires_at <= stamp || menu.used_at !== null || menu.guild_id !== i.guild_id ||
      menu.channel_id !== i.channel_id || menu.user_id !== i.member.user!.id) return reply('Este menu expirou ou já foi usado. Abra /categorias novamente.');
    const values = i.data!.values;
    const offered: string[] = JSON.parse(menu.category_ids);
    if (!Array.isArray(values) || values.length > 1 || new Set(values).size !== values.length ||
      values.some(v => typeof v !== 'string' || !offered.includes(v) || !active.some(c => String(c.id) === v))) {
      return reply('Uma categoria selecionada não está mais disponível ou é inválida. Abra /categorias novamente.');
    }
    const permissionError = await restrictChannel(env, i.guild_id, i.channel_id);
    if (permissionError) return permissionError;
    mutate('UPDATE discord_menus SET used_at=?,used_by=? WHERE id=? AND used_at IS NULL', stamp, token, sessionId);
    guard += ' AND EXISTS(SELECT 1 FROM discord_menus WHERE id=? AND used_by=?)';
    guardArgs.push(sessionId, token);
    // Upsert preserves a paused channel; configuring a blocked channel still requires /retomar.
    jobs.push(q(env.DB, `INSERT INTO discord_channels(id,guild_id,created_at,updated_at)
      SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`,
      i.channel_id, i.guild_id, stamp, stamp, ...guardArgs));
    mutate('DELETE FROM discord_subscriptions WHERE channel_id=?', i.channel_id);
    // Only one category per channel; legacy multi-category selections are replaced on save.
    if (values.length) mutate(`INSERT INTO discord_subscriptions(channel_id,category_id,created_at)
      SELECT ?,CAST(value AS INTEGER),? FROM json_each(?) WHERE 1`, i.channel_id, stamp, JSON.stringify(values));
    mutate(`UPDATE discord_deliveries SET status='cancelled',lease_until=0
      WHERE channel_id=? AND status IN ('pending','sending')`, i.channel_id);
    result = reply(`Categoria salva. Canal somente de leitura para membros; apenas o bot publica notícias. ${values.length ? 'Somente notícias coletadas a partir de agora serão enviadas.' : 'Nenhuma categoria selecionada.'}${channel && (!channel.active || channel.blocked) ? ' Use /retomar para habilitar os envios.' : ''}`);
  } else {
    if (!channel) return reply('Configure as categorias deste canal primeiro com /categorias.');
    const resume = command === 'retomar';
    if (resume) {
      if (selected.length > 1) return reply('Este canal tem várias categorias. Use /categorias para escolher uma única categoria antes de retomar.');
      const permissionError = await restrictChannel(env, i.guild_id, i.channel_id);
      if (permissionError) return permissionError;
    }
    mutate(`UPDATE discord_channels SET active=?,blocked=?,updated_at=?,last_error=NULL WHERE id=?`,
      Number(resume), resume ? 0 : channel.blocked, stamp, i.channel_id);
    if (resume) mutate('UPDATE discord_subscriptions SET created_at=? WHERE channel_id=?', stamp, i.channel_id);
    mutate(`UPDATE discord_deliveries SET status='cancelled',lease_until=0
      WHERE channel_id=? AND status IN ('pending','sending')`, i.channel_id);
    result = reply(resume ? 'Envios retomados. Somente notícias novas das categorias escolhidas serão enviadas.' : 'Envios pausados. As categorias do canal foram preservadas.');
  }
  // The response and mutations commit together. Concurrent/replayed requests cannot reset cutoffs.
  const fallback = sessionId ? reply('Este menu já foi usado. Abra /categorias novamente.') : result;
  await env.DB.batch([
    q(env.DB, 'INSERT OR IGNORE INTO discord_interactions(id,token,response,created_at) VALUES(?,?,?,?)', i.id, token, JSON.stringify(fallback), stamp),
    ...jobs,
    q(env.DB, `UPDATE discord_interactions SET response=? WHERE id=? AND ${guard}`, JSON.stringify(result), i.id, ...guardArgs),
  ]);
  const saved = await q(env.DB, 'SELECT response FROM discord_interactions WHERE id=?', i.id).first<{ response: string }>();
  return JSON.parse(saved!.response);
}

async function restrictChannel(env: Env, guild: string, channel: string): Promise<Reply | undefined> {
  try { await makeDiscordChannelReadOnly(env, guild, channel); }
  catch (error) {
    console.error(JSON.stringify({ job: 'discord-permissions', error: errorCode(error) }));
    return reply('Não foi possível restringir as mensagens deste canal ao bot. Verifique as permissões e a posição do cargo do bot e tente novamente. A configuração de envios não foi alterada.');
  }
}

export async function verifyDiscordSignature(request: Request, body: string, publicKey: string): Promise<boolean> {
  const signature = request.headers.get('X-Signature-Ed25519') ?? '';
  const timestamp = request.headers.get('X-Signature-Timestamp') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(publicKey) || !/^[0-9a-f]{128}$/i.test(signature) || !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(now() - Number(timestamp) * 1000) > 5 * 60_000) return false;
  const hex = (s: string) => Uint8Array.from(s.match(/../g)!, b => parseInt(b,16));
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hex(signature), new TextEncoder().encode(timestamp + body));
  } catch { return false; }
}

async function completeInteraction(env: Env, interaction: DiscordInteraction) {
  const deadline = now() + 27_000; // Leave margin within Workers' waitUntil lifetime.
  let result: Reply;
  try { result = await handleDiscordInteraction(env, interaction); }
  catch (error) {
    console.error(JSON.stringify({ job: 'discord-interaction', error: errorCode(error) }));
    result = reply('Não foi possível concluir a operação. Tente novamente.');
  }
  try {
    // Edit the deferred ephemeral response; never post configuration replies to the channel.
    // EPHEMERAL is fixed by the initial acknowledgement, not a valid editable flag.
    const { flags: _flags, ...data } = result.data;
    const path = `/webhooks/${env.DISCORD_APPLICATION_ID}/${encodeURIComponent(interaction.token!)}/messages/@original`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('DiscordResponseDeadline');
      try {
        await discordRequest(env, path, data, 'PATCH', true, Math.min(5000, remaining));
        break;
      } catch (error) {
        const retryable = error instanceof DiscordError && ([0,408,429].includes(error.status) || error.status >= 500);
        const delay = error instanceof DiscordError && error.status === 429
          ? Math.max(250, error.retryAfter * 1000 + 100) : 250 * 2 ** attempt;
        if (!retryable || attempt === 2 || now() + delay + 1000 >= deadline) throw error;
        // PATCHing the same original response is idempotent; do not rerun configuration writes.
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  } catch (error) { console.error(JSON.stringify({ job: 'discord-response', error: errorCode(error) })); }
}

export async function discordEndpoint(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (!env.DISCORD_PUBLIC_KEY || !env.DISCORD_APPLICATION_ID) return new Response('Discord not configured', { status: 503 });
  let body: string;
  try { body = await readLimited(new Response(request.body), 64_000); }
  catch { return new Response('Invalid body', { status: 400 }); }
  if (!await verifyDiscordSignature(request, body, env.DISCORD_PUBLIC_KEY)) return new Response('Unauthorized', { status: 401 });
  let i: DiscordInteraction;
  try { i = JSON.parse(body); }
  catch { return new Response('Invalid JSON', { status: 400 }); }
  if (!i || i.application_id !== env.DISCORD_APPLICATION_ID) return new Response('Invalid application', { status: 401 });
  if (i.type === 1) return Response.json({ type: 1 });
  if (![2,3].includes(i.type) || !snowflake(i.id) || typeof i.token !== 'string' || i.token.length < 1 || i.token.length > 2048) {
    return new Response('Invalid interaction', { status: 400 });
  }
  if (!ctx) throw new Error('MissingExecutionContext');
  ctx.waitUntil(completeInteraction(env, i));
  // Acknowledge before database/API work to meet Discord's three-second deadline.
  return Response.json({ type: 5, data: { flags: 64 } });
}
