// Print only operational metadata; raw tail events can contain secret headers.
import { spawn } from 'node:child_process';
const child=spawn('npx',['wrangler','tail','--format=json'],{stdio:['ignore','pipe','pipe']});
let buffer='',depth=0,quoted=false,escaped=false;
child.stdout.on('data',chunk=>{
  for(const c of chunk.toString()) {
    if(depth===0&&c!=='{') continue;
    buffer+=c;
    if(quoted) { if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; }
    else if(c==='"') quoted=true;
    else if(c==='{') depth++;
    else if(c==='}') depth--;
    if(depth===0) {
      try {
        const e=JSON.parse(buffer);
        console.log(JSON.stringify({time:e.eventTimestamp,outcome:e.outcome,
          event:e.event?.cron?'scheduled':e.event?.request?.url?new URL(e.event.request.url).pathname:'other',
          cpuTime:e.cpuTime,wallTime:e.wallTime,
          status:e.event?.response?.status,
          feedErrors:e.logs?.flatMap(l=>(l.message??[]).flatMap(m=>{
            try { const j=JSON.parse(m);return j.job==='feed-http'?[j]:[]; } catch {return [];} })),
          exceptions:e.exceptions?.map(x=>x.name)}));
      } catch {}
      buffer='';
    }
  }
});
child.stderr.on('data',()=>{});
process.on('SIGINT',()=>{child.kill('SIGTERM');process.exit(0);});
process.on('SIGTERM',()=>{child.kill('SIGTERM');process.exit(0);});
child.on('exit',code=>process.exit(code??0));
