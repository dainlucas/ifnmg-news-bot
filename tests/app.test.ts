import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from './db';
import { parseFeed, plainText, canonicalUrl, feedHash, readLimited } from '../src/feed';
import { classifyNext, collect, deliver } from '../src/pipeline';
import { validateAnswers } from '../src/jev';
import { newsMessage } from '../src/telegram';
import { handleUpdate } from '../src/bot';
import worker from '../src/index';
import type { Env } from '../src/types';

let database:ReturnType<typeof testDatabase>,env:Env;
const xml=(ids:number[])=>`<?xml version="1.0"?><rss version="2.0"><channel>${ids.map(id=>`<item><title>Bolsa de pesquisa ${id}</title><link>https://www.ifnmg.edu.br/noticia/${id}</link><guid>id-${id}</guid><description><![CDATA[<p>Inscrições &amp; seleção de estudantes.</p>]]></description><pubDate>Thu, 24 Sep 2026 11:00:00 -0300</pubDate></item>`).join('')}</channel></rss>`;
const categories=()=>database.sql.exec(`INSERT INTO categories(id,name,description,created_at) VALUES (1,'Bolsas','Bolsas para estudantes',1),(2,'Pesquisa','Oportunidades de pesquisa',1);
  INSERT INTO users(id,created_at) VALUES(1,1),(2,1);
  INSERT INTO subscriptions VALUES(1,1,1),(1,2,1),(2,1,1);`);
const ok=(result:unknown)=>new Response(JSON.stringify({ok:true,result}),{headers:{'Content-Type':'application/json'}});
const jev=()=>new Response(JSON.stringify({model:'test',answers:{cat_1:{type:'noul',noul:0.95},cat_2:{type:'noul',noul:0.8}},usage:{input_tokens:100}}));
const message=(id:number,text:string,user=1)=>({update_id:id,message:{text,chat:{id:user,type:'private'},from:{id:user}}});
beforeEach(()=>{database=testDatabase();env={DB:database.db,TELEGRAM_BOT_TOKEN:'fake',TYPESAFE_API_KEY:'fake',TELEGRAM_ADMIN_ID:'1',TELEGRAM_WEBHOOK_SECRET:'secret',TASK_SECRET:'task',APP_URL:'https://example.com',JEV_MODEL:'test',MATCH_THRESHOLD:'0.65'};});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();database.sql.close();});

describe('RSS and formatting',()=>{
  it('decodes UTF-8 across network chunks and enforces the byte limit',async()=>{
    const bytes=new TextEncoder().encode('Notícia');
    const stream=new ReadableStream({start(c){c.enqueue(bytes.slice(0,4));c.enqueue(bytes.slice(4));c.close();}});
    expect(await readLimited(new Response(stream))).toBe('Notícia');
    await expect(readLimited(new Response('abcdef'),3)).rejects.toThrow('BodyTooLarge');
  });
  it('ignores channel clock changes but detects new RSS items',async()=>{
    expect(await feedHash(xml([1]).replace('<channel>','<channel><lastBuildDate>today</lastBuildDate>')))
      .toBe(await feedHash(xml([1]).replace('<channel>','<channel><lastBuildDate>tomorrow</lastBuildDate>')));
    expect(await feedHash(xml([1,2]))).not.toBe(await feedHash(xml([1])));
    expect(await feedHash(xml([1]).replace('Bolsa de pesquisa','Título atualizado'))).toBe(await feedHash(xml([1])));
  });
  it('parses RSS, cleans HTML, and rejects entity declarations and external article URLs',()=>{
    const entries=parseFeed(xml([1]));expect(entries[0].summary).toBe('Inscrições & seleção de estudantes.');
    expect(entries[0].published).toBe('2026-09-24T14:00:00.000Z');
    expect(parseFeed(xml([]))).toEqual([]);
    expect(()=>parseFeed('<!DOCTYPE rss>'+xml([1]))).toThrow();
    expect(()=>parseFeed(xml([1]).replace('www.ifnmg.edu.br','evil.example'))).toThrow();
    expect(()=>parseFeed(xml([1]).replace('</rss>',''))).toThrow();
    expect(canonicalUrl('http://ifnmg.edu.br/a?utm_source=x&id=2#x')).toBe('https://www.ifnmg.edu.br/a?id=2');
    expect(()=>canonicalUrl('https://user:password@www.ifnmg.edu.br/a')).toThrow('UntrustedArticleUrl');
    expect(()=>canonicalUrl('https://www.ifnmg.edu.br:8443/a')).toThrow('UntrustedArticleUrl');
    expect(plainText('<script>steal()</script><p>ok</p>')).toBe('ok');
  });
  it('bounds long text and escapes user-controlled Telegram HTML',()=>{
    const output=newsMessage({title:'<fake>',summary:'&'.repeat(9000),url:'https://www.ifnmg.edu.br/a',source_name:'A&B'},['<cat>']);
    expect(output).toContain('&lt;fake&gt;');expect(output).not.toContain('<fake>');
    expect(plainText('a'.repeat(1_000_000)).length).toBe(6000);
  });
  it('rejects missing and out-of-range JEV answers',()=>{
    const c=[{id:1,name:'a',description:'a',version:1,active:1}];
    expect(()=>validateAnswers({answers:{}},c)).toThrow();
    expect(()=>validateAnswers({answers:{cat_1:{type:'noul',noul:1.2}}},c)).toThrow();
  });
});

async function newArticle() {
  categories();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(xml([1]))).mockResolvedValueOnce(new Response(xml([1,2]))));
  await collect(env,1);await collect(env,1);
}

describe('collection, classification and delivery',()=>{
  it('keeps remote error bodies and raw exception messages out of diagnostics',async()=>{
    const logger=vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('private upstream response',{status:503}))
      .mockRejectedValueOnce(new Error('private connection details')));
    await expect(collect(env,1)).rejects.toThrow('Feed request failed');
    expect(logger).toHaveBeenCalledExactlyOnceWith(JSON.stringify({job:'feed-http',source:1,status:503}));
    expect(database.sql.prepare('SELECT last_error FROM sources WHERE id=1').get()?.last_error).toBe('FeedHTTP503');
    await expect(collect(env,2)).rejects.toThrow('private connection details');
    expect(database.sql.prepare('SELECT last_error FROM sources WHERE id=2').get()?.last_error).toBe('Error');
    expect(logger).toHaveBeenCalledTimes(1);
  });
  it('baselines each source, ignores edits, deduplicates URLs across sources and survives a failed feed',async()=>{
    categories();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(xml([1]))).mockResolvedValueOnce(new Response(xml([1]).replace('Bolsa','Editada'))).mockResolvedValueOnce(new Response(xml([1]))).mockResolvedValueOnce(new Response('broken',{status:503})));
    await collect(env,1);await collect(env,1);await collect(env,2);await expect(collect(env,3)).rejects.toThrow();
    expect(database.sql.prepare('SELECT status,title FROM articles').all()).toEqual([{status:'seen',title:'Bolsa de pesquisa 1'}]);
    expect(database.sql.prepare('SELECT initialized_at FROM sources WHERE id=3').get()?.initialized_at).toBeNull();
  });
  it('uses independent categories and sends once per user; late subscriptions do not receive history',async()=>{
    await newArticle();
    database.sql.exec(`INSERT INTO users(id,created_at) VALUES(3,1); INSERT INTO subscriptions VALUES(3,1,9999999999999)`);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jev()));
    await classifyNext(env);
    expect(database.sql.prepare('SELECT COUNT(*) n FROM matches WHERE selected=1').get()?.n).toBe(2);
    expect(database.sql.prepare('SELECT user_id FROM deliveries ORDER BY user_id').all()).toEqual([{user_id:1},{user_id:2}]);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(ok({message_id:42}))));
    await deliver(env);await deliver(env);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(database.sql.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='sent'").get()?.n).toBe(2);
  });
  it('keeps a failed classification pending, without sending to arbitrary categories',async()=>{
    await newArticle();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('unavailable',{status:503})));
    await expect(classifyNext(env)).rejects.toThrow();
    expect(database.sql.prepare("SELECT COUNT(*) n FROM articles WHERE status='pending'").get()?.n).toBe(1);
    expect(database.sql.prepare('SELECT COUNT(*) n FROM deliveries').get()?.n).toBe(0);
  });
  it('retries only failed recipients and honors unsubscription before delivery',async()=>{
    await newArticle();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jev()));await classifyNext(env);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(ok({message_id:10})).mockResolvedValueOnce(new Response(JSON.stringify({ok:false,error_code:503}),{status:503})));
    await deliver(env);
    expect(database.sql.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='sent'").get()?.n).toBe(1);
    database.sql.exec('UPDATE deliveries SET next_attempt=0');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(ok({message_id:11})));await deliver(env);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels unsubscribed recipients and backs off the whole batch on Telegram 429',async()=>{
    await newArticle();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jev()));await classifyNext(env);
    database.sql.exec('DELETE FROM subscriptions WHERE user_id=2');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:false,error_code:429,parameters:{retry_after:120}}),{status:429})));
    await deliver(env);await deliver(env);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(database.sql.prepare("SELECT status FROM deliveries WHERE user_id=2").get()?.status).toBe('cancelled');
    expect(Number(database.sql.prepare("SELECT value FROM settings WHERE key='telegram_retry_at'").get()?.value)).toBeGreaterThan(Date.now());
  });
  it('does not create backlog while there are no categories',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(xml([1]))).mockResolvedValueOnce(new Response(xml([1,2]))));
    await collect(env,1);await collect(env,1);
    expect(database.sql.prepare("SELECT COUNT(*) n FROM articles WHERE status='seen'").get()?.n).toBe(2);
  });
  it('rechecks subscriptions during a batch, before each recipient is sent a message',async()=>{
    await newArticle();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jev()));await classifyNext(env);
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>{
      database.sql.exec('DELETE FROM subscriptions WHERE user_id=2');
      return Promise.resolve(ok({message_id:1}));
    }));
    await deliver(env);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(database.sql.prepare('SELECT status FROM deliveries WHERE user_id=2').get()?.status).toBe('cancelled');
  });
});

describe('bot permissions and subscriptions',()=>{
  it('admin creates a named category with a detailed description; replay does not duplicate it',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(ok({message_id:1}))));
    await handleUpdate(env,message(1,'/nova'));await handleUpdate(env,message(2,'Bolsas'));
    await handleUpdate(env,message(3,'Auxílios financeiros e bolsas para estudantes. Excluir vagas de emprego.'));
    await handleUpdate(env,message(3,'Auxílios financeiros e bolsas para estudantes. Excluir vagas de emprego.'));
    expect(database.sql.prepare('SELECT name,description FROM categories').all()).toEqual([{name:'Bolsas',description:'Auxílios financeiros e bolsas para estudantes. Excluir vagas de emprego.'}]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('protects admin controls even for crafted callbacks',async()=>{
    categories();vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(ok({message_id:1}))));
    await handleUpdate(env,message(1,'/nova',2));
    await handleUpdate(env,{update_id:2,callback_query:{id:'cb',data:'admin:off:1',from:{id:2},message:{message_id:1,chat:{id:2,type:'private'}}}});
    expect(database.sql.prepare('SELECT wizard FROM users WHERE id=2').get()?.wizard).toBeNull();
    expect(database.sql.prepare('SELECT active FROM categories WHERE id=1').get()?.active).toBe(1);
  });
  it('subscribes explicitly, pauses and resumes without backfilling history',async()=>{
    categories();vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(ok({message_id:1}))));
    await handleUpdate(env,message(1,'/parar',2));
    expect(database.sql.prepare('SELECT active FROM users WHERE id=2').get()?.active).toBe(0);
    await handleUpdate(env,message(2,'/retomar',2));
    expect(database.sql.prepare('SELECT created_at FROM subscriptions WHERE user_id=2').get()?.created_at).toBeGreaterThan(1);
  });
  it('resets the subscription cutoff when a blocked or paused person starts again',async()=>{
    categories();database.sql.exec('UPDATE users SET blocked=1 WHERE id=2');
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(ok({message_id:1}))));
    await handleUpdate(env,message(1,'/start',2));
    expect(database.sql.prepare('SELECT blocked FROM users WHERE id=2').get()?.blocked).toBe(0);
    expect(database.sql.prepare('SELECT created_at FROM subscriptions WHERE user_id=2').get()?.created_at).toBeGreaterThan(1);
  });
  it('enforces the initial 100-person limit without excluding existing users',async()=>{
    for(let id=1;id<=100;id++) database.sql.prepare('INSERT INTO users(id,created_at) VALUES(?,1)').run(id);
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(ok({message_id:1}))));
    await handleUpdate(env,message(1,'/start',101));await handleUpdate(env,message(2,'/start',1));
    expect(database.sql.prepare('SELECT COUNT(*) n FROM users').get()?.n).toBe(100);
    expect(database.sql.prepare('SELECT id FROM users WHERE id=101').get()).toBeUndefined();
  });
  it('rejects unauthenticated webhooks and task calls',async()=>{
    vi.stubGlobal('fetch',vi.fn());
    const a=await worker.fetch(new Request('https://example.com/webhook',{method:'POST',body:'{}'}),env);
    const b=await worker.fetch(new Request('https://example.com/internal/deliver',{method:'POST'}),env);
    expect(a.status).toBe(401);expect(b.status).toBe(401);expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects incorrect or unconfigured secrets on every protected endpoint',async()=>{
    vi.stubGlobal('fetch',vi.fn());
    for(const missing of [false,true]) {
      const config=missing?{...env,TELEGRAM_WEBHOOK_SECRET:'',TASK_SECRET:''}:env;
      for(const path of ['/webhook','/internal/collect?source=1','/internal/classify','/internal/deliver','/internal/status','/internal/dispatch?source=1']) {
        const response=await worker.fetch(new Request(`https://example.com${path}`,{method:'POST',body:'{}',
          headers:{Authorization:'Bearer wrong','X-Telegram-Bot-Api-Secret-Token':'wrong'}}),config);
        expect(response.status).toBe(401);
      }
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(database.sql.prepare('SELECT COUNT(*) n FROM bot_updates').get()?.n).toBe(0);
  });
});
