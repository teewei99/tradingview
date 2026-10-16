const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token){console.error('请先设置 TELEGRAM_BOT_TOKEN 环境变量，或使用 node --env-file=.env scripts/chat-id.mjs');process.exit(1);}
try{
  const res=await fetch(`https://api.telegram.org/bot${token}/getUpdates`,{signal:AbortSignal.timeout(10000)});
  const result=await res.json();if(!result.ok)throw Error('请求失败：请检查 Token，确认机器人没有其他 webhook / getUpdates 消费者');
  const chats=new Map();for(const update of result.result){const chat=update.message?.chat;if(chat)chats.set(chat.id,{id:chat.id,type:chat.type,name:chat.title||chat.first_name||chat.username});}
  console.log(chats.size?[...chats.values()]:'没有新消息。请先打开机器人点击 Start，再发一句消息，然后重试。');
}catch{console.error('无法读取会话。请检查网络、Token 和机器人是否被其他服务占用。');process.exitCode=1;}
