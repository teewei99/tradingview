import { SYMBOLS } from './store.mjs';
export class Market {
  constructor(store) {this.store=store;this.quotes={};this.connected=false;this.stopped=false;this.backoff=1000;this.lastFrame=0;}
  start() {
    if(this.stopped)return;
    // Reset baselines after gaps: never infer an unobserved crossing after reconnect.
    this.quotes={};
    const streams=SYMBOLS.map(s=>s.toLowerCase()+'@aggTrade').join('/');
    const ws=this.ws=new WebSocket('wss://stream.binance.com:9443/stream?streams='+streams);
    this.lastFrame=Date.now();
    ws.onopen=()=>{this.connected=true;this.backoff=1000;};
    ws.onmessage=e=>{
      this.lastFrame=Date.now();
      let d;try{d=JSON.parse(e.data).data;}catch{return;}
      const p=Number(d?.p), time=Number(d?.T);
      if(!SYMBOLS.includes(d?.s)||!Number.isFinite(p)||p<=0||!Number.isFinite(time))return;
      const prev=this.quotes[d.s];
      if(prev && time<prev.time)return;
      const fresh=Date.now()-time<30000;
      if(fresh && prev && Date.now()-prev.time<30000)this.store.tick(d.s,prev.price,p,time);
      this.quotes[d.s]={price:p,time};
    };
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{this.connected=false;clearInterval(this.watch);if(!this.stopped){this.timer=setTimeout(()=>this.start(),this.backoff);this.backoff=Math.min(this.backoff*2,30000);}};
    this.watch=setInterval(()=>{if(Date.now()-this.lastFrame>30000)ws.close();},10000);
  }
  stop(){this.stopped=true;clearTimeout(this.timer);clearInterval(this.watch);this.ws?.close();}
}
