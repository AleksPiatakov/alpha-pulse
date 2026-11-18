import assert from "node:assert/strict";
import {test} from "node:test";
import {assessScanFreshness} from "../lib/scan-freshness.ts";

test("unvisited, successful, expired and failed fetches are distinct",()=>{
 const t=1_000_000;
 const result=assessScanFreshness(
  ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT"],
  new Map([["BTCUSDT",t-20_000],["ETHUSDT",t-250_000],["SOLUSDT",t-500]]),
  new Set(["SOLUSDT"]),t,240_000
 );
 assert.deepEqual(result,{
  freshChecked:1,staleChecked:1,failedChecked:1,unchecked:1,
  oldestCheckedAgeSeconds:250,completeAndFresh:false
 });
});
test("complete and fresh requires every instrument successful",()=>{
 const symbols=["BTCUSDT","ETHUSDT"];
 const timestamps=new Map([["BTCUSDT",1000],["ETHUSDT",2000]]);
 assert.equal(assessScanFreshness(symbols,timestamps,new Set(),2000,2000).completeAndFresh,true);
 assert.equal(assessScanFreshness(symbols,timestamps,new Set(["BTCUSDT"]),2000,2000).completeAndFresh,false);
 assert.equal(assessScanFreshness([],new Map(),new Set(),2000,2000).completeAndFresh,false);
});
test("future timestamps fail closed instead of being counted as fresh",()=>{
 const result=assessScanFreshness(["BTCUSDT"],new Map([["BTCUSDT",4000]]),new Set(),3000,240_000);
 assert.equal(result.failedChecked,1);
 assert.equal(result.freshChecked,0);
 assert.equal(result.completeAndFresh,false);
});
