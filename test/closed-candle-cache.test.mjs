import assert from "node:assert/strict";
import {test} from "node:test";
import {ClosedCandleCache} from "../lib/closed-candle-cache.ts";
test("same completed candle boundary is fetched only once",async()=>{
 const cache=new ClosedCandleCache(3);let reads=0;
 const loader=async()=>{reads++;return {close:100}};
 const [first,second]=await Promise.all([
  cache.get("BTCUSDT:240",14400000,14401000,loader),
  cache.get("BTCUSDT:240",14400000,14401000,loader)]);
 assert.deepEqual(first,second);assert.equal(reads,1);
 await cache.get("BTCUSDT:240",14400000,14402000,loader);
 assert.equal(reads,1);
 await cache.get("BTCUSDT:240",28800000,28801000,loader);
 assert.equal(reads,2);
});
test("cache never reuses rejected fetches or stale snapshots",async()=>{
 const cache=new ClosedCandleCache(2);let n=0;
 await assert.rejects(cache.get("PAIR:60",3600000,3601000,async()=>{n++;throw Error("exchange error")}));
 assert.equal(cache.size,0);
 const a=await cache.get("PAIR:60",3600000,3601000,async()=>{n++;return n});
 const b=await cache.get("PAIR:60",3600000,3601000+30*60_000,async()=>{n++;return n});
 assert.equal(a,2);assert.equal(b,3);
});
test("memory is bounded while different symbols and candle times are scanned",async()=>{
 const cache=new ClosedCandleCache(2);
 for(let i=0;i<20;i++)await cache.get("PAIR"+i+":D",86400000,86401000,async()=>[i]);
 assert.equal(cache.size,2);
});
