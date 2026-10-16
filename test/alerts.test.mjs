import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store,crossed } from '../lib/store.mjs';
import { deliverOne } from '../lib/telegram.mjs';

test('direction, equal-price boundaries and missing baseline',()=>{
  assert.equal(crossed(99,100,100,'up'),true);
  assert.equal(crossed(101,100,100,'down'),true);
  for(const [prev,now,dir] of [[100,101,'up'],[101,102,'up'],[99,98,'down'],[100,99,'down'],[undefined,101,'up'],[NaN,101,'up']])assert.equal(crossed(prev,now,100,dir),false);
});
test('one-shot, wrong symbol, edits and cancellation',()=>{
  const s=new Store(':memory:');
  const id=s.add({symbol:'BTCUSDT',price:100,direction:'up'});
  assert.equal(s.pending(),undefined);assert.equal(s.tick('ETHUSDT',99,101).length,0);
  assert.equal(s.tick('BTCUSDT',101,102).length,0);
  s.edit(id,110);assert.equal(s.tick('BTCUSDT',99,101).length,0);
  assert.equal(s.tick('BTCUSDT',109,111).length,1);
  assert.equal(s.tick('BTCUSDT',109,111).length,0);
  assert.throws(()=>s.edit(id,120));
  const cancelled=s.add({symbol:'BTCUSDT',price:90,direction:'down'});s.remove(cancelled);
  assert.equal(s.tick('BTCUSDT',100,80).length,0);s.close();
});
test('validation rejects invalid prices and direction',()=>{
  const s=new Store(':memory:');for(const price of [0,-1,Infinity,NaN,'100'])assert.throws(()=>s.add({symbol:'BTCUSDT',price,direction:'up'}));
  assert.throws(()=>s.add({symbol:'INVALID',price:1,direction:'up'}));assert.throws(()=>s.add({symbol:'BTCUSDT',price:1,direction:'other'}));s.close();
});
test('durable outbox survives restart and retries failed delivery',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'linewatch-test-')),path=join(dir,'alerts.sqlite');
  let s=new Store(path);s.add({symbol:'BTCUSDT',price:100,direction:'up'});s.tick('BTCUSDT',99,101);const id=s.pending().id;s.close();s=new Store(path);
  assert.equal(s.list()[0].status,'triggered');assert.equal(s.pending().id,id);
  await deliverOne(s,async()=>{throw Error('offline');});assert.equal(s.delivery()[0].attempts,1);assert.equal(s.pending(),undefined);
  s.db.prepare('UPDATE outbox SET next=0').run();let sent=0;await deliverOne(s,async text=>{sent++;assert.match(text,/BTCUSDT/);});await deliverOne(s,async()=>sent++);
  assert.equal(sent,1);assert.equal(s.delivery()[0].status,'sent');s.close();rmSync(dir,{recursive:true});
});
