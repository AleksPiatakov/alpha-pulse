import assert from "node:assert/strict";
import {test} from "node:test";
import {orderMarketScan,selectSweepBatch} from "../lib/market-scan-scheduler.ts";
test("coarse ticker ranking prioritizes liquid pairs but never removes thin pairs",()=>{
  const input=[{symbol:"ZUSDT",turnover24h:"100",lastPrice:"1"},
    {symbol:"BTCUSDT",turnover24h:"400000000",lastPrice:"70000"},
    {symbol:"XUSDT",turnover24h:"0",lastPrice:"2"},
    {symbol:"ETHUSDT",turnover24h:"100000000",lastPrice:"4000"}];
  const original=structuredClone(input);
  assert.deepEqual(orderMarketScan(input),["BTCUSDT","ETHUSDT","ZUSDT","XUSDT"]);
  assert.deepEqual(input,original);
});
test("pin the cycle order across batches and cover each pair exactly once",()=>{
  const universe=Array.from({length:237},(_,i)=>"PAIR"+i+"USDT");
  let cursor=0;const scanned=[];
  do{
    const batch=selectSweepBatch(universe,cursor,64);
    scanned.push(...batch.symbols);
    cursor=batch.nextCursor;
  }while(cursor>0);
  assert.equal(scanned.length,universe.length);
  assert.equal(new Set(scanned).size,universe.length);
  assert.deepEqual(scanned,universe);
});
test("empty universe and invalid offsets do not fabricate coverage",()=>{
 assert.deepEqual(selectSweepBatch([],0,64),{symbols:[],nextCursor:0,finished:true});
 assert.throws(()=>selectSweepBatch(["BTCUSDT"],-1,64));
 assert.throws(()=>selectSweepBatch(["BTCUSDT"],0,0));
});
