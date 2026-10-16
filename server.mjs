import http from 'node:http';
import { readFileSync,mkdirSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';
import { Store,SYMBOLS } from './lib/store.mjs';
import { Market } from './lib/market.mjs';
import { sendTelegram,deliverOne } from './lib/telegram.mjs';

const password=process.env.APP_PASSWORD;
if(!password||password.length<16)throw new Error('请设置至少 16 个字符的 APP_PASSWORD');
if(process.env.NODE_ENV==='production'&&!process.env.RAILWAY_VOLUME_MOUNT_PATH&&!process.env.ALLOW_EPHEMERAL)throw new Error('请挂载 Railway Volume 到 /data，避免重启丢失提醒');
const root=dirname(fileURLToPath(import.meta.url));
const data=process.env.DATA_DIR||join(root,'data');mkdirSync(data,{recursive:true});
const store=new Store(join(data,'alerts.sqlite'));
const market=new Market(store);
if(process.env.MARKET_DISABLED!=='1')market.start();
const salt=randomBytes(32), passHash=scryptSync(password,salt,32), sessions=new Map();
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
const cache=new Map();let loginTries=[],lastTest=0,delivering=false;
const timer=setInterval(async()=>{if(delivering)return;delivering=true;try{await deliverOne(store);}finally{delivering=false;}},2000);
async function body(req){let value='';for await(const c of req){value+=c;if(value.length>8192)throw new Error('请求过大');}return JSON.parse(value||'{}');}
const readyTelegram=()=>Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID);
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
    const url=new URL(req.url,'http://local');const path=url.pathname;
    if(path==='/healthz'&&req.method==='GET')return json(200,{ok:true});
    if(!['GET','HEAD'].includes(req.method)&&req.headers['content-type']!=='application/json')return json(415,{error:'需要 JSON 请求'});
    if(req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'不允许跨站请求'});
    if(path==='/api/login'&&req.method==='POST'){
      loginTries=loginTries.filter(t=>Date.now()-t<60000);if(loginTries.length>=10)return json(429,{error:'尝试过多，请一分钟后重试'});loginTries.push(Date.now());
      const input=await body(req);if(typeof input.password!=='string'||input.password.length>1024||!timingSafeEqual(scryptSync(input.password,salt,32),passHash))return json(401,{error:'密码不正确'});
      for(const [k,v] of sessions)if(v<Date.now())sessions.delete(k);
      const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+86400000);
      res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV==='production'?'; Secure':''}`);return json(200,{ok:true});
    }
    if(assets.has(path)&&req.method==='GET'){const [file,type]=assets.get(path);res.writeHead(200,{'Content-Type':type});return res.end(readFileSync(join(root,'public',file)));}
    const session=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);
    if(!session||!(sessions.get(session)>Date.now()))return json(401,{error:'请先登录'});
    if(path==='/api/logout'&&req.method==='POST'){sessions.delete(session);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
    if(path==='/api/state'&&req.method==='GET')return json(200,{symbols:SYMBOLS,quotes:market.quotes,connected:market.connected,telegram:readyTelegram(),alerts:store.list(),delivery:store.delivery()});
    if(path==='/api/alerts'&&req.method==='POST'){
      const input=await body(req),q=market.quotes[input.symbol];
      if(!readyTelegram())return json(409,{error:'先配置 Telegram 并发送测试通知'});
      if(!market.connected||!q||Date.now()-q.time>30000)return json(409,{error:'行情尚未连接，请稍后再设提醒'});
      return json(201,{id:store.add(input)});
    }
    const match=path.match(/^\/api\/alerts\/([a-f0-9-]+)$/);
    if(match&&req.method==='PATCH'){
      const a=store.list().find(a=>a.id===match[1]),q=market.quotes[a?.symbol];
      if(!market.connected||!q||Date.now()-q.time>30000)return json(409,{error:'行情离线，暂不能修改价格'});
      store.edit(match[1],(await body(req)).price);return json(200,{ok:true});
    }
    if(match&&req.method==='DELETE'){store.remove(match[1]);return json(200,{ok:true});}
    if(path==='/api/test'&&req.method==='POST'){
      if(Date.now()-lastTest<30000)return json(429,{error:'请等待 30 秒再测试'});lastTest=Date.now();
      await sendTelegram('✅ 价格线提醒已连接。收到这条消息后，即可在网页设置价格线。');return json(200,{ok:true});
    }
    if(path==='/api/candles'&&req.method==='GET'){
      const symbol=url.searchParams.get('symbol'),interval=url.searchParams.get('interval')||'15m';
      if(!SYMBOLS.includes(symbol)||!['1m','15m','1h','4h','1d'].includes(interval))return json(400,{error:'交易对或周期无效'});
      const key=symbol+interval,cached=cache.get(key);if(cached&&Date.now()-cached.time<15000)return json(200,cached.data);
      let upstream;try{upstream=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`,{signal:AbortSignal.timeout(10000)});}catch{return json(502,{error:'Binance 行情暂时不可用，请检查部署区域与网络'});}
      if(!upstream.ok)return json(502,{error:`Binance 返回 ${upstream.status}，请检查服务区域是否可用`});
      const candles=await upstream.json();cache.set(key,{time:Date.now(),data:candles});return json(200,candles);
    }
    json(404,{error:'未找到'});
  }catch(e){json(400,{error:e.message||'请求失败'});}
});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log(`Local: http://localhost:${Number(process.env.PORT)||3000}`));
function stop(){clearInterval(timer);market.stop();server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
