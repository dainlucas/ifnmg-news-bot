import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const all=Object.fromEntries(readFileSync(new URL('../.dev.vars',import.meta.url),'utf8').split('\n').filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const names=['TELEGRAM_BOT_TOKEN','TYPESAFE_API_KEY','TELEGRAM_ADMIN_ID','TELEGRAM_WEBHOOK_SECRET','TASK_SECRET'];
if(names.some(name=>!all[name])) throw new Error('Missing local secrets');
const child=spawn('npx',['wrangler','secret','bulk'],{stdio:['pipe','inherit','inherit']});
child.stdin.end(JSON.stringify(Object.fromEntries(names.map(n=>[n,all[n]]))));
child.on('exit',code=>process.exit(code??1));
