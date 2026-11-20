import assert from "node:assert/strict";
import {test} from "node:test";
import {floorQuantityToBybitStep,normalizeDemoOrderQuantity} from "../lib/bybit-quantity.ts";
const rules={tickSize:.00001,qtyStep:1,minOrderQty:1,minNotionalValue:5};
test("rounds down rather than up, preserving maximum risk and margin",()=>{
 assert.equal(floorQuantityToBybitStep(1339954.42539615,rules),1339954);
 assert.equal(floorQuantityToBybitStep(5.99,{...rules,qtyStep:.1}),5.9);
 assert.equal(floorQuantityToBybitStep(.123456,{...rules,qtyStep:.001}),.123);
});
test("rejects quantities smaller than exchange minimum",()=>{
 const x=normalizeDemoOrderQuantity({quantity:.9,entry:.05786,stop:.05908,target:.05542},rules);
 assert.ok(x.errors.length>0);
});
test("maintains valid precision and avoids widening prices",()=>{
 const x=normalizeDemoOrderQuantity({quantity:1339954.42539615,entry:.05786,stop:.05908,target:.05542},rules);
 assert.equal(x.quantity,1339954);
 assert.deepEqual(x.errors,[]);
});
