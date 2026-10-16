// Deterministic UI QA only. No live prices, credentials, or Telegram messages.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {Store,SYMBOLS} from '../lib/store.mjs';
const store=new Store(':memory:');
store.add({symbol:'BTCUSDT',price:68100,direction:'up'});
store.add({symbol:'BTCUSDT',price:66300,direction:'down'});
const prices={BTCUSDT:67420,ETHUSDT:2500,SOLUSDT:150,BNBUSDT:600,XRPUSDT:.6,DOGEUSDT:.12};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
 if(url.pathname==='/api/state')return json({symbols:SYMBOLS,quotes:Object.fromEntries(SYMBOLS.map(s=>[s,{price:prices[s],time:Date.now()}])),connected:true,telegram:true,alerts:store.list(),delivery:[]});
 if(url.pathname==='/api/candles'){const p=prices[url.searchParams.get('symbol')]||67420;return json(Array.from({length:300},(_,i)=>{const o=p*(1+Math.sin(i/14)*.012+(i-300)*.00002),c=o+p*Math.sin(i*3)*.002;return [Date.now()-(300-i)*900000,o,Math.max(o,c)+p*.002,Math.min(o,c)-p*.002,c];}));}
 if(req.url.startsWith('/api/alerts')){let text='';for await(const chunk of req)text+=chunk;try{const input=JSON.parse(text||'{}'),id=url.pathname.split('/')[3];if(req.method==='POST')return json({id:store.add(input)});if(req.method==='PATCH')store.edit(id,input.price);if(req.method==='DELETE')store.remove(id);return json({ok:true});}catch(e){res.statusCode=400;return json({error:e.message});}}
 const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']},entry=files[url.pathname];if(!entry){res.statusCode=404;return json({error:'UI fixture only'});}
 res.setHeader('Content-Type',entry[1]);let content=readFileSync(new URL('../public/'+entry[0],import.meta.url),'utf8');if(entry[0]==='index.html')content=content.replace('YOUR PRICE. YOUR SIGNAL.','界面测试 · 模拟行情 · 不发送通知');res.end(content);
}).listen(3001,'127.0.0.1',()=>console.log('UI fixture: http://localhost:3001'));
