import { handleUpdate } from './bot';
import { collect, classifyNext, deliver } from './pipeline';
import { readLimited } from './feed';
import { errorCode, statement as q, type Env } from './types';

export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health') return Response.json({service:'noticias-ifnmg',ok:true});
    try {
      if(url.pathname==='/webhook'&&request.method==='POST') {
        if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET) return new Response('Unauthorized',{status:401});
        const payload=JSON.parse(await readLimited(new Response(request.body),64_000));
        await handleUpdate(env,payload);
        return new Response('OK');
      }
      if(url.pathname.startsWith('/internal/')&&request.method==='POST') {
        if(!env.TASK_SECRET||request.headers.get('Authorization')!==`Bearer ${env.TASK_SECRET}`) return new Response('Unauthorized',{status:401});
        if(url.pathname==='/internal/collect') {
          const source=Number(url.searchParams.get('source'));
          if(!Number.isInteger(source)||source<1||source>6) return new Response('Invalid source',{status:400});
          return Response.json(await collect(env,source));
        }
        if(url.pathname==='/internal/classify') return Response.json(await classifyNext(env));
        if(url.pathname==='/internal/deliver') return Response.json(await deliver(env));
        if(url.pathname==='/internal/status') {
          const sources=await env.DB.prepare('SELECT id,name,initialized_at,last_success,last_error FROM sources').all();
          const categories=await env.DB.prepare('SELECT id,name,active FROM categories').all();
          const stats=await env.DB.prepare(`SELECT
            (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM articles) articles,
            (SELECT COUNT(*) FROM deliveries WHERE status='sent') sent,
            (SELECT COUNT(*) FROM deliveries WHERE status IN ('pending','sending')) pending`).first();
          return Response.json({sources:sources.results,categories:categories.results,stats});
        }
        if(url.pathname==='/internal/dispatch') {
          const source=Number(url.searchParams.get('source'));
          if(!Number.isInteger(source)||source<1||source>6) return new Response('Invalid source',{status:400});
          const response=await fetch(new URL(`/internal/collect?source=${source}`,env.APP_URL),{
            method:'POST',headers:{Authorization:`Bearer ${env.TASK_SECRET}`,'User-Agent':'NoticiasIF-Scheduler/1.0'},signal:AbortSignal.timeout(60_000)});
          return new Response(await response.text(),{status:response.status,headers:{'Content-Type':'application/json'}});
        }
      }
      return new Response('Not found',{status:404});
    } catch(error) {
      // Never log raw request bodies, headers, URLs containing credentials or provider error bodies.
      console.error(JSON.stringify({path:url.pathname,error:errorCode(error)}));
      return new Response('Temporary failure',{status:503});
    }
  },
  async scheduled(event:ScheduledController,env:Env,ctx:ExecutionContext) {
    if(!env.APP_URL) return;
    const slot=Math.floor(event.scheduledTime/60_000)%10;
    const paths=['/internal/classify','/internal/deliver'];
    if(slot<6) paths.push(`/internal/collect?source=${slot+1}`);
    // Independent HTTP invocations give each stage its own CPU/subrequest budget.
    ctx.waitUntil(Promise.all(paths.map(async path=>{
      try {
        const response=await fetch(new URL(path,env.APP_URL),{method:'POST',headers:{Authorization:`Bearer ${env.TASK_SECRET}`,'User-Agent':'NoticiasIF-Scheduler/1.0'},signal:AbortSignal.timeout(300_000)});
        if(!response.ok) console.error(JSON.stringify({job:path,status:response.status}));
        await response.body?.cancel();
      } catch(error) { console.error(JSON.stringify({job:path,error:errorCode(error)})); }
    })));
    if(Math.floor(event.scheduledTime/60_000)%1440===0) {
      ctx.waitUntil(q(env.DB,'DELETE FROM bot_updates WHERE created_at<? AND status=\'done\'',event.scheduledTime-7*86400_000).run());
    }
  },
} satisfies ExportedHandler<Env>;
