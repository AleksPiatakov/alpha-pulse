import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {EMA50_CUTOFF,verifyEmaStudySnapshot} from "../lib/video-ema50-history.ts";

test("EMA50 history requires every closed candle; no hidden stop-loss gaps",()=>{
  const days=120,start=EMA50_CUTOFF-days*86400000;
  const candles={};
  for(const [frame,period] of [["15",900000],["60",3600000],["240",14400000]]){
    candles[frame]=Array.from({length:(EMA50_CUTOFF-start)/period},(_,i)=>({
      time:start+i*period,open:100,high:101,low:99,close:100,volume:10,
    }));
  }
  const content={schema:1,source:"bybit-public-linear",symbol:"BTCUSDT",cutoff:EMA50_CUTOFF,
    days,capturedAt:"2026-11-13T00:00:00.000Z",candles};
  const seal=(value)=>({...value,sha256:createHash("sha256").update(JSON.stringify(value)).digest("hex")});
  assert.equal(verifyEmaStudySnapshot(seal(content)).symbol,"BTCUSDT");
  const missing=structuredClone(content);
  missing.candles["15"].splice(350,1);
  assert.throws(()=>verifyEmaStudySnapshot(seal(missing)),/Неповна історія|Пропуск/);
  const shifted=structuredClone(content);
  shifted.candles["60"][440].time+=3600000;
  assert.throws(()=>verifyEmaStudySnapshot(seal(shifted)),/Пропуск|Некоректні/);
  const truncated=structuredClone(content);
  truncated.candles["240"].pop();
  assert.throws(()=>verifyEmaStudySnapshot(seal(truncated)),/Неповна історія/);
});
