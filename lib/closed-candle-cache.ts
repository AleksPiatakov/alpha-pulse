/**
 * Bounded, point-in-time cache for fully closed Bybit candles.
 * Keys include the completed candle cutoff: no unfinished bar can be reused
 * as a finished bar at the next timeframe boundary.
 */
export class ClosedCandleCache<T> {
  private readonly entries = new Map<string, {data:T; expiresAt:number}>();
  private readonly pending = new Map<string,Promise<T>>();
  constructor(private readonly maxEntries=1500) {
    if(!Number.isInteger(maxEntries)||maxEntries<1)throw Error("Invalid cache size");
  }
  async get(key:string,cutoff:number,now:number,loader:()=>Promise<T>):Promise<T> {
    if(!Number.isSafeInteger(cutoff)||!Number.isSafeInteger(now)||cutoff<0||now<0||!key)
      throw Error("Invalid candle snapshot cache key");
    const id=key+":"+cutoff;
    const cached=this.entries.get(id);
    if(cached&&cached.expiresAt>now){
      this.entries.delete(id);this.entries.set(id,cached);
      return cached.data;
    }
    if(cached)this.entries.delete(id);
    const running=this.pending.get(id);
    if(running)return running;
    const work=loader().then(data=>{
      // TTL only guards transient missing exchange updates. New candle cutoff
      // necessarily creates a different cache key.
      this.entries.set(id,{data,expiresAt:now+30*60_000});
      while(this.entries.size>this.maxEntries)
        this.entries.delete(this.entries.keys().next().value!);
      return data;
    }).finally(()=>{this.pending.delete(id);});
    this.pending.set(id,work);
    return work;
  }
  get size(){return this.entries.size;}
}
