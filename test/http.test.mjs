import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('HTTP authentication, CSRF protection, offline state and logout',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'linewatch-http-'));
  const port=32000+Math.floor(Math.random()*10000),password='test-password-not-for-deployment';
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),APP_PASSWORD:password,DATA_DIR:dir,MARKET_DISABLED:'1',NODE_ENV:'test',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:''},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('server timeout')),10000).unref())]);
    const url=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(url+'/healthz')).status,200);
    assert.equal((await fetch(url+'/api/state')).status,401);
    assert.equal((await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({password})})).status,415);
    assert.equal((await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},body:JSON.stringify({password})})).status,403);
    let response=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    const headers={'Content-Type':'application/json',Cookie:cookie};
    response=await fetch(url+'/api/state',{headers});const state=await response.json();assert.equal(state.connected,false);assert.equal(state.telegram,false);
    assert.equal((await fetch(url+'/api/alerts',{method:'POST',headers,body:JSON.stringify({symbol:'BTCUSDT',price:100,direction:'up'})})).status,409);
    await fetch(url+'/api/logout',{method:'POST',headers,body:'{}'});assert.equal((await fetch(url+'/api/state',{headers})).status,401);
  }finally{child.kill();await once(child,'exit');rmSync(dir,{recursive:true});}
});
