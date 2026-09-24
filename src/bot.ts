import { telegram } from './telegram';
import { now, statement as q, type Category, type Env } from './types';

type Button = { text: string } & ({ callback_data: string; url?: never } | { url: string; callback_data?: never });
const BOT_URL='https://t.me/noticiasIf_bot';
const SHARE_TEXT='Acompanhe as notícias do IFNMG no Telegram! Abra @noticiasIf_bot, toque em Iniciar e escolha as categorias que deseja receber.';
type Call = { method: string; body: Record<string,unknown> };
type User = { id:number; active:number; blocked:number; wizard:string|null };
type Wizard = { step:'name'|'description'; categoryId?:number; name?:string; expires:number };
type Update = {
  update_id:number;
  message?: { text?:string; chat:{id:number;type:string}; from?:{id:number;is_bot?:boolean} };
  callback_query?: { id:string; data?:string; from:{id:number;is_bot?:boolean}; message?:{message_id:number;chat:{id:number;type:string}} };
};

export async function planUpdate(env:Env,update:Update,user:User):Promise<{sql:D1PreparedStatement[];calls:Call[]}> {
  const sql:D1PreparedStatement[]=[],calls:Call[]=[];
  const admin=String(user.id)===env.TELEGRAM_ADMIN_ID;
  const callback=update.callback_query;
  const text=update.message?.text?.trim()??'';
  const command=text.startsWith('/')?text.split(/\s/)[0].split('@')[0].toLowerCase():'';
  const data=callback?.data??'';
  const stamp=now();
  if(user.blocked) {
    // A new private interaction proves that the person has unblocked this bot.
    sql.push(q(env.DB,'UPDATE users SET blocked=0 WHERE id=?',user.id));
    sql.push(q(env.DB,'UPDATE subscriptions SET created_at=? WHERE user_id=?',stamp,user.id));
    user.blocked=0;
  }
  const categories=(await q(env.DB,'SELECT * FROM categories ORDER BY id').all<Category>()).results;
  const subscriptions=(await q(env.DB,'SELECT category_id FROM subscriptions WHERE user_id=?',user.id).all<{category_id:number}>()).results.map(x=>x.category_id);

  function show(message:string,rows:Button[][]=[]) {
    const body:Record<string,unknown>={chat_id:user.id,text:message,reply_markup:{inline_keyboard:rows}};
    // Sending a fresh menu avoids Telegram's "message is not modified" retry ambiguity.
    calls.push({method:'sendMessage',body});
  }
  function homeRows():Button[][] {
    return [[{text:'📚 Escolher categorias',callback_data:'menu:categories'}],
      [{text:'📋 Minhas inscrições',callback_data:'menu:mine'}],
      [{text:'📤 Compartilhar',callback_data:'menu:share'}],
      [{text:user.active?'⏸ Pausar avisos':'▶️ Retomar avisos',callback_data:user.active?'pause':'resume'}],
      ...(admin?[[{text:'⚙️ Administrar categorias',callback_data:'admin:list'}]]:[])];
  }
  function categoryMenu(prefix='Escolha as categorias que deseja acompanhar. Toque para seguir ou deixar de seguir. Você recebe cada notícia uma única vez.') {
    const active=categories.filter(c=>c.active);
    show(active.length?prefix:'Ainda não há categorias disponíveis. Volte após o administrador cadastrá-las.',
      [...active.map(c=>[{text:`${subscriptions.includes(c.id)?'✅':'➕'} ${c.name}`,callback_data:`${subscriptions.includes(c.id)?'unsub':'sub'}:${c.id}`}]),
        [{text:'🏠 Menu',callback_data:'menu:home'}]]);
  }
  function adminMenu(prefix='Administração de categorias\nEscolha uma categoria para ver a descrição, editar ou desativar.') {
    show(prefix,[...categories.map(c=>[{text:`${c.active?'🟢':'⚪'} ${c.name}`,callback_data:`admin:view:${c.id}`}]),
      [{text:'➕ Nova categoria',callback_data:'admin:new'}],[{text:'🏠 Menu',callback_data:'menu:home'}]]);
  }
  function setWizard(value:Wizard|null) { sql.push(q(env.DB,'UPDATE users SET wizard=? WHERE id=?',value?JSON.stringify(value):null,user.id)); }
  const backAdmin:Button[][]=[[{text:'⚙️ Categorias',callback_data:'admin:list'}]];

  if(data.startsWith('admin:')||['/admin','/nova','/status'].includes(command)) {
    if(!admin) { show('Somente o administrador pode alterar categorias.',homeRows()); return {sql,calls}; }
    if(command==='/status') {
      const sources=(await q(env.DB,'SELECT name,initialized_at,last_success,last_error FROM sources ORDER BY id').all<{name:string;initialized_at:number|null;last_success:number|null;last_error:string|null}>()).results;
      const counts=await q(env.DB,`SELECT (SELECT COUNT(*) FROM users) users,
        (SELECT COUNT(*) FROM deliveries WHERE status IN ('pending','sending')) pending,
        (SELECT COUNT(*) FROM deliveries WHERE status='failed') failed,
        (SELECT COUNT(*) FROM articles WHERE status IN ('pending','processing')) classifying`).first<any>();
      const time=(n:number|null)=>n?new Date(n).toISOString().replace('T',' ').slice(0,16)+' UTC':'aguardando';
      show(`Situação do bot\nPessoas: ${counts.users}/100\nA classificar: ${counts.classifying}\nEntregas pendentes: ${counts.pending}\nEntregas com falha permanente: ${counts.failed}\n\n`+
        sources.map(s=>`${s.last_error?'⚠️':s.initialized_at?'✅':'⏳'} ${s.name}\nÚltima coleta: ${time(s.last_success)}${s.last_error?'\nErro: '+s.last_error:''}`).join('\n\n'),backAdmin);
    } else if(command==='/nova'||data==='admin:new') {
      if(categories.length>=20) show('O limite inicial é de 20 categorias. Edite uma categoria existente.',backAdmin);
      else { setWizard({step:'name',expires:stamp+30*60_000}); show('Qual é o nome da nova categoria? Envie até 60 caracteres.\n\nUse /cancelar para sair.'); }
    } else if(data.startsWith('admin:view:')) {
      const c=categories.find(c=>c.id===Number(data.split(':')[2]));
      if(!c) adminMenu('Categoria não encontrada.');
      else show(`${c.name}\n\n${c.description}\n\nSituação: ${c.active?'ativa':'desativada'}`,
        [[{text:'✏️ Editar nome e descrição',callback_data:`admin:edit:${c.id}`}],
          [{text:c.active?'⏸ Desativar':'▶️ Ativar',callback_data:`admin:${c.active?'off':'on'}:${c.id}`}],...backAdmin]);
    } else if(data.startsWith('admin:edit:')) {
      const c=categories.find(c=>c.id===Number(data.split(':')[2]));
      if(!c) adminMenu('Categoria não encontrada.');
      else { setWizard({step:'name',categoryId:c.id,expires:stamp+30*60_000}); show(`Nome atual: ${c.name}\n\nEnvie o novo nome (até 60 caracteres), /manter para preservá-lo ou /cancelar.`); }
    } else if(data.startsWith('admin:off:')||data.startsWith('admin:on:')) {
      const id=Number(data.split(':')[2]),enabled=Number(data.startsWith('admin:on:'));
      sql.push(q(env.DB,'UPDATE categories SET active=?,version=version+1 WHERE id=?',enabled,id));
      const c=categories.find(c=>c.id===id); if(c) c.active=enabled;
      adminMenu(enabled?'Categoria ativada.':'Categoria desativada. As inscrições ficam preservadas para uma futura reativação.');
    } else { setWizard(null); adminMenu(); }
    return {sql,calls};
  }

  if(command==='/cancelar') { setWizard(null); show('Operação cancelada.',homeRows()); return {sql,calls}; }
  if(command==='/start'||command==='/ajuda'||data==='menu:home') {
    setWizard(null);
    if(command==='/start') {
      if(!user.active||user.blocked) sql.push(q(env.DB,'UPDATE subscriptions SET created_at=? WHERE user_id=?',stamp,user.id));
      user.active=1;
      sql.push(q(env.DB,'UPDATE users SET active=1,blocked=0 WHERE id=?',user.id));
    }
    show('Notícias IFNMG\n\nAcompanhe os assuntos que interessam a você. Escolha suas categorias e receba novas publicações do IFNMG aqui, sem notícias repetidas.\n\nVocê pode mudar as escolhas ou pausar os avisos a qualquer momento.',homeRows());
    return {sql,calls};
  }
  if(command==='/compartilhar'||data==='menu:share') {
    show(`${SHARE_TEXT}\n\n${BOT_URL}`,
      [[{text:'📤 Compartilhar no Telegram',url:`tg://msg_url?url=${encodeURIComponent(BOT_URL)}&text=${encodeURIComponent(SHARE_TEXT)}`}],
        [{text:'📲 Abrir bot no aplicativo',url:'tg://resolve?domain=noticiasIf_bot'}],
        [{text:'🏠 Menu',callback_data:'menu:home'}]]);
    return {sql,calls};
  }
  if(command==='/categorias'||data==='menu:categories') { setWizard(null); categoryMenu(); return {sql,calls}; }
  if(command==='/minhas'||data==='menu:mine') {
    const selected=categories.filter(c=>subscriptions.includes(c.id));
    show(`${user.active?'Avisos ativos':'Avisos pausados'}\n\n${selected.length?selected.map(c=>`• ${c.name}${c.active?'':' (desativada)'}`).join('\n'):'Você ainda não segue nenhuma categoria.'}`,homeRows());
    return {sql,calls};
  }
  if(command==='/parar'||data==='pause'||command==='/retomar'||data==='resume') {
    const active=Number(command==='/retomar'||data==='resume'); user.active=active;
    sql.push(q(env.DB,'UPDATE users SET active=? WHERE id=?',active,user.id));
    if(!active) sql.push(q(env.DB,"UPDATE deliveries SET status='cancelled' WHERE user_id=? AND status='pending'",user.id));
    else sql.push(q(env.DB,'UPDATE subscriptions SET created_at=? WHERE user_id=?',stamp,user.id));
    show(active?'Avisos retomados. Você receberá novas notícias das categorias escolhidas.':'Avisos pausados. Suas categorias foram preservadas.',homeRows());
    return {sql,calls};
  }
  if(data.startsWith('sub:')||data.startsWith('unsub:')) {
    const id=Number(data.split(':')[1]),c=categories.find(c=>c.id===id&&c.active);
    if(!c) { categoryMenu('Essa categoria não está mais disponível.'); return {sql,calls}; }
    if(data.startsWith('sub:')) {
      sql.push(q(env.DB,'INSERT OR IGNORE INTO subscriptions(user_id,category_id,created_at) VALUES(?,?,?)',user.id,id,stamp));
      if(!subscriptions.includes(id)) subscriptions.push(id);
      categoryMenu(`Você está acompanhando “${c.name}”.${user.active?'':' Seus avisos estão pausados; use /retomar para receber notícias.'}\n\nEscolha outras categorias abaixo.`);
    } else {
      sql.push(q(env.DB,'DELETE FROM subscriptions WHERE user_id=? AND category_id=?',user.id,id));
      const pos=subscriptions.indexOf(id); if(pos>=0) subscriptions.splice(pos,1);
      categoryMenu(`Você deixou de acompanhar “${c.name}”.`);
    }
    return {sql,calls};
  }

  let wizard:Wizard|null=null;
  if(user.wizard) { try { wizard=JSON.parse(user.wizard); } catch {} }
  if(admin&&wizard&&wizard.expires>stamp&&!callback) {
    const c=categories.find(c=>c.id===wizard!.categoryId);
    if(wizard.step==='name') {
      const name=command==='/manter'?c?.name??'':text;
      if(!name||name.length>60||name.startsWith('/')) show('Envie um nome de 1 a 60 caracteres ou /cancelar.');
      else { setWizard({...wizard,step:'description',name,expires:stamp+30*60_000}); show(`Categoria: ${name}\n\nAgora envie uma descrição detalhada (até 3.000 caracteres). Explique o que incluir, o que excluir e dê exemplos para orientar a classificação.${c?'\n\nUse /manter para preservar a descrição atual.':''}\n\nUse /cancelar para sair.`); }
    } else {
      const description=command==='/manter'?c?.description??'':text;
      if(description.length<10||description.length>3000||description.startsWith('/')) show('Envie uma descrição de 10 a 3.000 caracteres, com os critérios da categoria, ou /cancelar.');
      else {
        if(wizard.categoryId) sql.push(q(env.DB,'UPDATE categories SET name=?,description=?,version=version+1 WHERE id=?',wizard.name!,description,wizard.categoryId));
        else sql.push(q(env.DB,'INSERT INTO categories(name,description,created_at) VALUES(?,?,?)',wizard.name!,description,stamp));
        setWizard(null);
        show(`Categoria “${wizard.name}” salva. Os critérios serão usados nas novas notícias.\n\nPara também receber os avisos, escolha a categoria em /categorias.`,backAdmin);
      }
    }
  } else { if(wizard) setWizard(null); show('Use os botões abaixo para escolher suas categorias e controlar os avisos.',homeRows()); }
  return {sql,calls};
}

export async function handleUpdate(env:Env,update:Update) {
  if(!Number.isSafeInteger(update.update_id)) return;
  const message=update.message??update.callback_query?.message;
  const from=update.message?.from??update.callback_query?.from;
  if(!message||message.chat.type!=='private'||!from||from.is_bot||from.id!==message.chat.id) return;
  const stamp=now();
  const old=await q(env.DB,'SELECT * FROM bot_updates WHERE id=?',update.update_id).first<{status:string;response:string|null;lease_until:number}>();
  if(old?.status==='done') return;
  let calls:Call[];
  if(old?.status==='ready') calls=JSON.parse(old.response!);
  else {
    const claimed=await q(env.DB,`INSERT INTO bot_updates(id,status,lease_until,created_at) VALUES(?,'processing',?,?)
      ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE bot_updates.status='processing' AND bot_updates.lease_until<? RETURNING id`,update.update_id,stamp+30_000,stamp,stamp).first();
    if(!claimed) throw new Error('UpdateBusy');
    const user=await q(env.DB,`INSERT INTO users(id,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM users)<100 OR EXISTS(SELECT 1 FROM users WHERE id=?)
      ON CONFLICT(id) DO UPDATE SET id=excluded.id RETURNING *`,from.id,stamp,from.id).first<User>();
    const plan=user?await planUpdate(env,update,user):{sql:[],calls:[{method:'sendMessage',body:{chat_id:from.id,text:'O bot atingiu o limite inicial de 100 pessoas. Tente novamente mais tarde.'}}]};
    calls=plan.calls;
    await env.DB.batch([...plan.sql,q(env.DB,"UPDATE bot_updates SET status='ready',response=?,lease_until=0 WHERE id=?",JSON.stringify(calls),update.update_id)]);
  }
  if(update.callback_query) {
    try { await telegram(env,'answerCallbackQuery',{callback_query_id:update.callback_query.id}); } catch { /* A replayed callback may have expired. */ }
  }
  for(const call of calls) await telegram(env,call.method,call.body);
  await q(env.DB,"UPDATE bot_updates SET status='done',response=NULL WHERE id=?",update.update_id).run();
}
