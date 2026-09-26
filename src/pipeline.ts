import { articleId, feedHash, parseFeed, plainText, readLimited } from './feed';
import { classify } from './jev';
import { newsMessage, telegram, TelegramError } from './telegram';
import { now, statement as q, errorCode, type Article, type Category, type Env } from './types';

interface Source { id: number; name: string; url: string; initialized_at: number | null; etag: string | null; modified: string | null; content_hash: string | null }

export async function collect(env: Env, sourceId: number) {
  const stamp = now();
  const source = await q(env.DB, `UPDATE sources SET lease_until=?,last_poll=?
    WHERE id=? AND lease_until<? RETURNING *`, stamp + 90_000, stamp, sourceId, stamp).first<Source>();
  if (!source) return { busy: true };
  try {
    const headers: Record<string, string> = { 'User-Agent': 'NoticiasIF/1.0 RSS subscriber bot', Accept: 'application/rss+xml,application/xml' };
    if (source.initialized_at && source.etag) headers['If-None-Match'] = source.etag;
    if (source.initialized_at && source.modified) headers['If-Modified-Since'] = source.modified;
    const response = await fetch(source.url, { method:'GET', headers, signal: AbortSignal.timeout(25_000) });
    if (response.status === 304 && source.initialized_at) {
      await q(env.DB,'UPDATE sources SET last_success=?,last_error=NULL,lease_until=0 WHERE id=?',stamp,sourceId).run();
      return { unchanged: true };
    }
    if (!response.ok) {
      await response.body?.cancel();
      console.error(JSON.stringify({job:'feed-http',source:sourceId,status:response.status}));
      const error=new Error('Feed request failed');
      error.name=`FeedHTTP${response.status}`;
      throw error;
    }
    const xml=await readLimited(response),hash=await feedHash(xml);
    if(source.initialized_at&&hash===source.content_hash) {
      await q(env.DB,`UPDATE sources SET last_success=?,last_error=NULL,lease_until=0,etag=?,modified=? WHERE id=?`,stamp,response.headers.get('etag'),response.headers.get('last-modified'),sourceId).run();
      return { unchanged:true };
    }
    // Keep description HTML untouched until deduplication identifies a new article.
    const entries = parseFeed(xml,false);
    // Current IFNMG feeds expose at most 15 items. Protect D1 Free's 50-query budget.
    if (entries.length > 20) throw new Error('FeedNeedsLargerBatch');
    const categories = (await q(env.DB,'SELECT * FROM categories WHERE active=1 ORDER BY id').all<Category>()).results;
    const seen = new Set(entries.length ? (await q(env.DB,`SELECT guid FROM source_items WHERE source_id=? AND guid IN (${entries.map(()=>'?').join(',')})`,sourceId,...entries.map(e=>e.guid)).all<{guid:string}>()).results.map(x=>x.guid) : []);
    const jobs: D1PreparedStatement[] = [];
    let inserted = 0;
    for (const entry of entries) {
      if (seen.has(entry.guid)) continue;
      seen.add(entry.guid);
      const id = await articleId(entry.url);
      jobs.push(q(env.DB,`INSERT OR IGNORE INTO articles
        (id,guid,url,title,summary,source_name,published,captured_at,categories,status)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,id,entry.guid,entry.url,entry.title,source.initialized_at&&categories.length?plainText(entry.summary):'',source.name,entry.published,stamp,JSON.stringify(categories),
        source.initialized_at && categories.length ? 'pending' : 'seen'));
      jobs.push(q(env.DB,'INSERT OR IGNORE INTO source_items(source_id,guid,article_id) VALUES(?,?,?)',sourceId,entry.guid,id));
      inserted++;
    }
    jobs.push(q(env.DB,`UPDATE sources SET initialized_at=COALESCE(initialized_at,?),last_success=?,lease_until=0,
      etag=?,modified=?,content_hash=?,last_error=NULL WHERE id=?`,stamp,stamp,response.headers.get('etag'),response.headers.get('last-modified'),hash,sourceId));
    await env.DB.batch(jobs);
    console.log(JSON.stringify({ job:'collect', source:sourceId, baseline:!source.initialized_at, items:entries.length, unseen:inserted }));
    return { baseline:!source.initialized_at, items:entries.length, unseen:inserted };
  } catch (error) {
    await q(env.DB,'UPDATE sources SET lease_until=0,last_error=? WHERE id=?',errorCode(error),sourceId).run();
    throw error;
  }
}

export async function classifyNext(env: Env) {
  const stamp=now(), token=crypto.randomUUID();
  const article=await q(env.DB,`UPDATE articles SET status='processing',lease_until=?,lease_token=?,attempts=attempts+1
    WHERE id=(SELECT id FROM articles WHERE status IN ('pending','processing') AND lease_until<? AND next_attempt<=?
    ORDER BY captured_at LIMIT 1) RETURNING *`,stamp+90_000,token,stamp,stamp).first<Article>();
  if(!article) return { processed:0 };
  try {
    const snapshot=JSON.parse(article.categories) as Category[];
    const active=(await q(env.DB,'SELECT * FROM categories WHERE active=1').all<Category>()).results;
    // Deactivations cancel routing; historical criteria remain fixed for queued articles.
    const categories=snapshot.filter(c=>active.some(a=>a.id===c.id));
    const result=categories.length ? await classify(env,article,categories) : null;
    const threshold=Number(env.MATCH_THRESHOLD);
    if(!Number.isFinite(threshold)||threshold<0||threshold>1) throw new Error('InvalidThreshold');
    const jobs:D1PreparedStatement[]=[];
    for(const c of categories) jobs.push(q(env.DB,`INSERT OR REPLACE INTO matches(article_id,category_id,version,probability,selected)
      VALUES(?,?,?,?,?)`,article.id,c.id,c.version,result!.probabilities.get(c.id)!,Number(result!.probabilities.get(c.id)!>=threshold)));
    jobs.push(q(env.DB,`INSERT OR IGNORE INTO deliveries(article_id,user_id)
      SELECT DISTINCT m.article_id,s.user_id FROM matches m JOIN subscriptions s ON s.category_id=m.category_id
      JOIN categories c ON c.id=m.category_id JOIN users u ON u.id=s.user_id
      WHERE m.article_id=? AND m.selected=1 AND c.active=1 AND u.active=1 AND u.blocked=0 AND s.created_at<=?`,article.id,article.captured_at));
    // Fan out the same persisted JEV result; never classify separately per platform.
    jobs.push(q(env.DB,`INSERT OR IGNORE INTO discord_deliveries(article_id,channel_id)
      SELECT DISTINCT m.article_id,s.channel_id FROM matches m
      JOIN discord_subscriptions s ON s.category_id=m.category_id
      JOIN categories c ON c.id=m.category_id JOIN discord_channels d ON d.id=s.channel_id
      WHERE m.article_id=? AND m.selected=1 AND c.active=1 AND d.active=1 AND d.blocked=0
      AND s.created_at<=?`,article.id,article.captured_at));
    jobs.push(q(env.DB,`UPDATE articles SET status='classified',lease_until=0,last_error=NULL,model=?,input_tokens=?
      WHERE id=? AND lease_token=?`,result?.model??null,result?.inputTokens??0,article.id,token));
    await env.DB.batch(jobs);
    console.log(JSON.stringify({job:'classify',article:article.id,matches:[...(result?.probabilities??[])].filter(([,p])=>p>=threshold).length}));
    return { processed:1 };
  } catch(error) {
    await q(env.DB,`UPDATE articles SET status='pending',lease_until=0,next_attempt=?,last_error=? WHERE id=? AND lease_token=?`,
      stamp+Math.min(3_600_000,60_000*2**Math.min(article.attempts,6)),errorCode(error),article.id,token).run();
    throw error;
  }
}

export const eligibleDelivery = `EXISTS(SELECT 1 FROM matches m JOIN subscriptions s ON s.category_id=m.category_id
  JOIN categories c ON c.id=m.category_id JOIN users u ON u.id=s.user_id JOIN articles a ON a.id=m.article_id
  WHERE m.article_id=deliveries.article_id AND s.user_id=deliveries.user_id AND m.selected=1 AND c.active=1
  AND u.active=1 AND u.blocked=0 AND s.created_at<=a.captured_at)`;

export async function deliver(env:Env) {
  const stamp=now(),token=crypto.randomUUID();
  const retry=await q(env.DB,"SELECT value FROM settings WHERE key='telegram_retry_at'").first<{value:string}>();
  if(Number(retry?.value??0)>stamp) return { throttled:true };
  await q(env.DB,`UPDATE deliveries SET status='cancelled' WHERE status IN ('pending','sending') AND lease_until<? AND NOT ${eligibleDelivery}`,stamp).run();
  // One message per recipient per tick. All claimed rows share an expiring ownership token.
  const rows=(await q(env.DB,`UPDATE deliveries SET status='sending',lease_until=?,lease_token=?,attempts=attempts+1
    WHERE rowid IN (SELECT MIN(rowid) FROM deliveries WHERE status IN ('pending','sending') AND lease_until<? AND next_attempt<=?
    AND ${eligibleDelivery} GROUP BY user_id LIMIT 20) RETURNING article_id,user_id,attempts`,stamp+600_000,token,stamp,stamp)
    .all<{article_id:string;user_id:number;attempts:number}>()).results;
  if(!rows.length) return { sent:0 };
  const articles=(await q(env.DB,`SELECT a.*,GROUP_CONCAT(c.name,' · ') AS category_names FROM articles a
    LEFT JOIN matches m ON m.article_id=a.id AND m.selected=1 LEFT JOIN categories c ON c.id=m.category_id AND c.active=1
    WHERE a.id IN (SELECT article_id FROM deliveries WHERE lease_token=?) GROUP BY a.id`,token).all<Article & {category_names:string}>()).results;
  const blockedUsers:number[]=[];
  let sent=0, throttleUntil=0;
  // Sequential requests avoid a burst above Telegram's free broadcast rate.
  for(const row of rows) {
    if(throttleUntil) {
      await q(env.DB,`UPDATE deliveries SET status='pending',lease_until=0,next_attempt=? WHERE article_id=? AND user_id=? AND lease_token=?`,throttleUntil,row.article_id,row.user_id,token).run();
      continue;
    }
    const eligible=await q(env.DB,`SELECT 1 FROM deliveries WHERE article_id=? AND user_id=? AND lease_token=? AND ${eligibleDelivery}`,row.article_id,row.user_id,token).first();
    if(!eligible) {
      await q(env.DB,"UPDATE deliveries SET status='cancelled',lease_until=0 WHERE article_id=? AND user_id=? AND lease_token=?",row.article_id,row.user_id,token).run();
      continue;
    }
    const a=articles.find(x=>x.id===row.article_id)!;
    try {
      const message=await telegram(env,'sendMessage',{chat_id:row.user_id,text:newsMessage(a,[a.category_names??'']),parse_mode:'HTML',link_preview_options:{is_disabled:true}});
      await q(env.DB,`UPDATE deliveries SET status='sent',message_id=?,sent_at=?,lease_until=0,last_error=NULL
        WHERE article_id=? AND user_id=? AND lease_token=?`,message.message_id,now(),row.article_id,row.user_id,token).run();
      sent++;
    } catch(error) {
      const status=error instanceof TelegramError?error.status:0;
      if(status===429) throttleUntil=now()+Math.max(1,(error as TelegramError).retryAfter)*1000+1000;
      if(status===403) blockedUsers.push(row.user_id);
      await q(env.DB,`UPDATE deliveries SET status=?,next_attempt=?,lease_until=0,last_error=? WHERE article_id=? AND user_id=? AND lease_token=?`,
        status===403?'cancelled':status===400?'failed':'pending',throttleUntil||now()+Math.min(3_600_000,60_000*2**Math.min(row.attempts,6)),
        errorCode(error),row.article_id,row.user_id,token).run();
    }
  }
  if(blockedUsers.length) await q(env.DB,`UPDATE users SET blocked=1 WHERE id IN (${blockedUsers.map(()=>'?').join(',')})`,...blockedUsers).run();
  if(throttleUntil) await q(env.DB,"UPDATE settings SET value=? WHERE key='telegram_retry_at'",String(throttleUntil)).run();
  console.log(JSON.stringify({job:'deliver',claimed:rows.length,sent}));
  return { sent,claimed:rows.length };
}
