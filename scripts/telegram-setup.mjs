import { readFileSync } from 'node:fs';

const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const vars=Object.fromEntries(readFileSync(new URL('../.dev.vars',import.meta.url),'utf8').split('\n').filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
if(!config.vars.APP_URL||!vars.TELEGRAM_BOT_TOKEN||!vars.TELEGRAM_WEBHOOK_SECRET||!vars.TELEGRAM_ADMIN_ID) throw new Error('Missing configuration');
async function call(method,body) {
  let response;
  try { response=await fetch(`https://api.telegram.org/bot${vars.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error('Telegram connection failed'); }
  const data=await response.json();
  if(!response.ok||!data.ok) throw new Error(`Telegram ${method}: HTTP ${response.status}`);
  return data.result;
}
const commands=[{command:'start',description:'Abrir o menu'},{command:'categorias',description:'Escolher categorias para acompanhar'},{command:'minhas',description:'Ver minhas inscrições'},{command:'compartilhar',description:'Compartilhar o link do bot'},{command:'parar',description:'Pausar notificações'},{command:'retomar',description:'Retomar notificações'},{command:'cancelar',description:'Cancelar uma operação'}];
await call('setMyCommands',{commands});
await call('setMyCommands',{scope:{type:'chat',chat_id:Number(vars.TELEGRAM_ADMIN_ID)},commands:[...commands,{command:'admin',description:'Administrar categorias'},{command:'nova',description:'Cadastrar uma categoria'},{command:'status',description:'Ver coletas e entregas'}]});
await call('setMyDescription',{description:'Acompanhe novas publicações do IFNMG. Escolha as categorias de seu interesse e receba as notícias aqui.'});
await call('setWebhook',{url:config.vars.APP_URL+'/webhook',secret_token:vars.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query'],max_connections:1,drop_pending_updates:false});
const info=await call('getWebhookInfo',{});
console.log(JSON.stringify({webhook:info.url,pending_updates:info.pending_update_count,last_error:info.last_error_message??null}));
