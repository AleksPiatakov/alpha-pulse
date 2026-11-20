/** Round a position DOWN to the exact Bybit quantity step; never exceed
 * user-submitted size, nominal margin or risk budget. */
import type {ExecutionRules} from "./bybit-execution-rules.ts";
import {validateOrderPrecision} from "./bybit-execution-rules.ts";

export function floorQuantityToBybitStep(quantity:number,rules:ExecutionRules):number|null{
  const step=rules.qtyStep;
  if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(step)||step<=0)return null;
  const decimalPlaces=(String(step).split(".")[1]??"").length;
  if(decimalPlaces>12)return null;
  const scale=10**decimalPlaces;
  const increment=Math.round(step*scale);
  if(!Number.isSafeInteger(increment)||increment<=0)return null;
  // Guard floating-point arithmetic and never round above the intended quantity.
  const units=Math.floor(quantity/step+1e-9);
  if(!Number.isSafeInteger(units)||units<=0)return null;
  const result=Number(((units*increment)/scale).toFixed(decimalPlaces));
  return Number.isFinite(result)&&result>0&&result<=quantity+Math.max(1e-9,quantity*1e-12)?result:null;
}
export function normalizeDemoOrderQuantity(
  request:{quantity:number;entry:number;stop:number;target:number},rules:ExecutionRules
):{quantity:number;errors:string[]}{
  const quantity=floorQuantityToBybitStep(request.quantity,rules);
  if(quantity===null)return {quantity:0,errors:["Неможливо безпечно округлити кількість до qtyStep Bybit."]};
  return {quantity,errors:validateOrderPrecision({
    entry:request.entry,stop:request.stop,target:request.target,quantity
  },rules)};
}
