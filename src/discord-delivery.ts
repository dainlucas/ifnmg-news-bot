import { DiscordError, sendDiscordNews } from './discord';
import { now, statement as q, errorCode, type Article, type Env } from './types';

export const eligibleDiscordDelivery = `EXISTS(SELECT 1 FROM matches m
  JOIN discord_subscriptions s ON s.category_id=m.category_id
  JOIN categories c ON c.id=m.category_id JOIN discord_channels d ON d.id=s.channel_id
  JOIN articles a ON a.id=m.article_id
  WHERE m.article_id=discord_deliveries.article_id AND s.channel_id=discord_deliveries.channel_id
  AND m.selected=1 AND c.active=1 AND d.active=1 AND d.blocked=0 AND s.created_at<=a.captured_at)`;

export async function deliverDiscord(env: Env) {
  if (!env.DISCORD_BOT_TOKEN) return { disabled: true };
  const stamp = now(), token = crypto.randomUUID();
  const lock = await q(env.DB, `UPDATE discord_dispatch SET lease_until=?,lease_token=?
    WHERE id=1 AND lease_until<? AND retry_at<=? RETURNING id`, stamp + 180_000, token, stamp, stamp).first();
  if (!lock) return { busy: true };
  let sent = 0;
  try {
    await q(env.DB, `UPDATE discord_deliveries SET status='cancelled',lease_until=0
      WHERE status IN ('pending','sending') AND lease_until<? AND NOT ${eligibleDiscordDelivery}`, stamp).run();
    // Eight destinations bound runtime and D1 queries; at most one message/channel/tick.
    const rows = (await q(env.DB, `UPDATE discord_deliveries SET status='sending',lease_until=?,lease_token=?,attempts=attempts+1
      WHERE rowid IN (SELECT MIN(rowid) FROM discord_deliveries
      WHERE status IN ('pending','sending') AND lease_until<? AND next_attempt<=?
      AND channel_id IN (SELECT id FROM discord_channels WHERE retry_at<=?)
      AND ${eligibleDiscordDelivery} GROUP BY channel_id LIMIT 8)
      RETURNING article_id,channel_id,attempts`, stamp + 180_000, token, stamp, stamp, stamp)
      .all<{ article_id: string; channel_id: string; attempts: number }>()).results;
    if (!rows.length) return { sent: 0 };
    const articles = (await q(env.DB, `SELECT a.*,GROUP_CONCAT(c.name,' · ') AS category_names FROM articles a
      LEFT JOIN matches m ON m.article_id=a.id AND m.selected=1
      LEFT JOIN categories c ON c.id=m.category_id AND c.active=1
      WHERE a.id IN (SELECT article_id FROM discord_deliveries WHERE lease_token=?) GROUP BY a.id`, token)
      .all<Article & { category_names: string | null }>()).results;
    for (const row of rows) {
      // Configuration may change after the claim; recheck immediately before the API call.
      const eligible = await q(env.DB, `SELECT 1 FROM discord_deliveries WHERE article_id=? AND channel_id=?
        AND status='sending' AND lease_token=? AND ${eligibleDiscordDelivery}`, row.article_id, row.channel_id, token).first();
      if (!eligible) {
        await q(env.DB, `UPDATE discord_deliveries SET status='cancelled',lease_until=0
          WHERE article_id=? AND channel_id=? AND lease_token=?`, row.article_id, row.channel_id, token).run();
        continue;
      }
      const article = articles.find(a => a.id === row.article_id)!;
      try {
        const result = await sendDiscordNews(env, row.channel_id, article, [article.category_names ?? '']);
        await env.DB.batch([
          q(env.DB, `UPDATE discord_deliveries SET status='sent',message_id=?,sent_at=?,lease_until=0,last_error=NULL
            WHERE article_id=? AND channel_id=? AND lease_token=?`, result.messageId, now(), row.article_id, row.channel_id, token),
          q(env.DB, 'UPDATE discord_channels SET retry_at=?,last_error=NULL WHERE id=?',
            result.retryAfter ? now() + result.retryAfter * 1000 + 1000 : 0, row.channel_id),
        ]);
        sent++;
      } catch (error) {
        const status = error instanceof DiscordError ? error.status : 0;
        const global = status === 401 || (error instanceof DiscordError && status === 429 && error.global);
        const retryAt = now() + (status === 401 ? 3_600_000 : status === 429
          ? Math.max(1, (error as DiscordError).retryAfter) * 1000 + 1000
          : Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attempts, 7)));
        const unavailable = status === 403 || status === 404;
        const permanent = status >= 400 && status < 500 && ![401,403,404,408,429].includes(status);
        const jobs = [q(env.DB, `UPDATE discord_deliveries SET status=?,lease_until=0,next_attempt=?,last_error=?
          WHERE article_id=? AND channel_id=? AND lease_token=?`, unavailable ? 'cancelled' : permanent ? 'failed' : 'pending',
          retryAt, errorCode(error), row.article_id, row.channel_id, token)];
        if (unavailable) {
          jobs.push(q(env.DB, 'UPDATE discord_channels SET blocked=1,last_error=? WHERE id=?', errorCode(error), row.channel_id));
          jobs.push(q(env.DB, `UPDATE discord_deliveries SET status='cancelled',lease_until=0
            WHERE channel_id=? AND status IN ('pending','sending')`, row.channel_id));
        } else if (global) {
          jobs.push(q(env.DB, 'UPDATE discord_dispatch SET retry_at=?,last_error=? WHERE id=1 AND lease_token=?', retryAt, errorCode(error), token));
        } else {
          jobs.push(q(env.DB, 'UPDATE discord_channels SET retry_at=?,last_error=? WHERE id=?', retryAt, errorCode(error), row.channel_id));
        }
        await env.DB.batch(jobs);
        if (global) break;
      }
    }
    return { sent, claimed: rows.length };
  } finally {
    // Release unattempted rows after global backoff or a database failure, then the mutex.
    await q(env.DB, `UPDATE discord_deliveries SET status='pending',lease_until=0
      WHERE status='sending' AND lease_token=?`, token).run();
    await q(env.DB, 'UPDATE discord_dispatch SET lease_until=0 WHERE id=1 AND lease_token=?', token).run();
  }
}
