import {test} from "node:test";
import assert from "node:assert/strict";
import {assessTpObstacle} from "../lib/tp-obstacle.ts";

test("SHORT TP close to observed daily low is reported, not rejected",()=>{
 const bars=Array.from({length:50},(_,i)=>({low:i===42?54:60+i%3,
   high:65+i%4,close:62}));
 const result=assessTpObstacle(bars,"SHORT",60,62,54.2);
 assert.equal(result.status,"NEAR_OBSTACLE");
 assert.equal(result.lookbackBars,50);
});
test("distant range extreme is not reported as nearby",()=>{
 const bars=Array.from({length:45},(_,i)=>({low:50+i%2,high:60+i%2,close:55}));
 const result=assessTpObstacle(bars,"SHORT",59,61,55);
 assert.equal(result.status,"NO_NEAR_OBSTACLE");
});
test("incomplete data returns uncertainty",()=>{
 assert.equal(assessTpObstacle([],"LONG",50,48,54).status,"INSUFFICIENT_DATA");
});
