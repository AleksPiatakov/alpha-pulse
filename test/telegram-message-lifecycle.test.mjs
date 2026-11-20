import {test} from "node:test";
import assert from "node:assert/strict";
import {shouldRetireTelegramSignal} from "../lib/telegram-message-lifecycle.ts";
const now=2_000_000;
test("short outage or missing one rotating TOP entry never removes alerts",()=>{
 assert.equal(shouldRetireTelegramSignal(1,now-30_000,now),false);
 assert.equal(shouldRetireTelegramSignal(2,now-20*60_000,now),false);
 assert.equal(shouldRetireTelegramSignal(10,now-2*60_000,now),false);
});
test("sustained missing confirmation retires old message",()=>{
 assert.equal(shouldRetireTelegramSignal(3,now-10*60_000,now),true);
 assert.equal(shouldRetireTelegramSignal(4,now-11*60_000,now),true);
});
test("invalid timing or counters do not trigger destructive Telegram action",()=>{
 assert.equal(shouldRetireTelegramSignal(3,0,now),false);
 assert.equal(shouldRetireTelegramSignal(3,now+100,now),false);
 assert.equal(shouldRetireTelegramSignal(NaN,now-20*60_000,now),false);
});
