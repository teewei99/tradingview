import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT'];
export function crossed(previous, current, target, direction) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return false;
  return direction === 'up' ? previous < target && current >= target : previous > target && current <= target;
}
export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,symbol TEXT,price REAL,direction TEXT,status TEXT,created INTEGER,triggered INTEGER,observed REAL);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,text TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,next INTEGER DEFAULT 0,error TEXT);`);
  }
  list() { return this.db.prepare('SELECT * FROM alerts ORDER BY created DESC').all(); }
  add({symbol,price,direction}) {
    if (!SYMBOLS.includes(symbol) || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || !['up','down'].includes(direction)) throw new Error('交易对、价格或方向无效');
    if (this.list().filter(a=>a.status==='active').length >= 100) throw new Error('最多同时启用 100 条提醒');
    const id = randomUUID();
    this.db.prepare("INSERT INTO alerts VALUES(?,?,?,?,'active',?,NULL,NULL)").run(id,symbol,price,direction,Date.now());
    return id;
  }
  edit(id,price) {
    if (typeof price !== 'number' || !Number.isFinite(price) || price<=0) throw new Error('价格无效');
    const result=this.db.prepare("UPDATE alerts SET price=? WHERE id=? AND status='active'").run(price,id);
    if (!result.changes) throw new Error('提醒已触发或不存在');
  }
  remove(id) { this.db.prepare("UPDATE alerts SET status='cancelled' WHERE id=? AND status='active'").run(id); }
  tick(symbol,previous,current,time=Date.now()) {
    const hits=this.db.prepare("SELECT * FROM alerts WHERE status='active' AND symbol=?").all(symbol).filter(a=>crossed(previous,current,a.price,a.direction));
    if(!hits.length)return hits;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const a of hits) {
        this.db.prepare("UPDATE alerts SET status='triggered',triggered=?,observed=? WHERE id=?").run(time,current,a.id);
        const text=`🔔 ${symbol} ${a.direction==='up'?'向上突破':'向下跌破'}\n提醒价：${a.price} USDT\n成交价：${current} USDT\n时间：${new Date(time).toISOString()}\n提醒编号：${a.id.slice(0,8)}\n本条提醒已完成。`;
        this.db.prepare('INSERT INTO outbox(id,text) VALUES(?,?)').run(a.id,text);
      }
      this.db.exec('COMMIT');
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
    return hits;
  }
  pending(now=Date.now()) { return this.db.prepare("SELECT * FROM outbox WHERE status='pending' AND next<=? ORDER BY next LIMIT 1").get(now); }
  delivered(id) {this.db.prepare("UPDATE outbox SET status='sent',error=NULL WHERE id=?").run(id);}
  retry(id,error,delay) {this.db.prepare('UPDATE outbox SET attempts=attempts+1,error=?,next=? WHERE id=?').run(error,Date.now()+delay,id);}
  delivery() {return this.db.prepare('SELECT id,status,attempts,error FROM outbox').all();}
  close(){this.db.close();}
}
