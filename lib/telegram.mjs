export async function sendTelegram(text,env=process.env) {
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw new Error('Telegram 尚未配置');
  let res;
  try {res=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text}),signal:AbortSignal.timeout(10000)});}catch{throw new Error('Telegram 网络不可用');}
  const body=await res.json().catch(()=>({}));
  if(!res.ok||!body.ok)throw new Error(`Telegram 请求失败（${res.status}），请检查 Token、Chat ID 与 Start 状态`);
}
export async function deliverOne(store,send=sendTelegram) {
  const item=store.pending();if(!item)return;
  try{await send(item.text);store.delivered(item.id);}
  catch(e){store.retry(item.id,e.message,Math.min(300000,5000*2**Math.min(item.attempts,6)));}
}
