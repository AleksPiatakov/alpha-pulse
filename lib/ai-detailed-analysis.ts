import type {TradePlan} from "./trading.ts";

/** Fact-bound, educational interpretation; never creates a trading signal/order. */
export type DetailedAiReport={
  marketContext:string;
  entryLogic:string;
  confirmationConditions:string[];
  invalidation:string;
  riskAnalysis:string;
  beginnerExplanation:string;
  nextAction:string;
};
export type DetailedAiResult={
  report:DetailedAiReport|null;
  status:{state:"ok"|"cached"|"fallback";code:string;message:string;model?:string};
};
const MODEL=process.env.OPENAI_MODEL||"gpt-4.1-mini";
const fields=["marketContext","entryLogic","confirmationConditions","invalidation",
  "riskAnalysis","beginnerExplanation","nextAction"] as const;
function parseOutput(data:{output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>}){
  return typeof data.output_text==="string"?data.output_text:
    data.output?.flatMap(x=>x.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join("")??"";
}
function valid(raw:unknown):raw is DetailedAiReport{
  if(!raw||typeof raw!=="object")return false;
  const obj=raw as Record<string,unknown>;
  return fields.every(key=>key==="confirmationConditions"
    ?Array.isArray(obj[key])&&obj[key].length>0&&obj[key].every((v:unknown)=>typeof v==="string"&&v.trim().length>0)
    :typeof obj[key]==="string"&&(obj[key] as string).trim().length>0);
}
let saved:{key:string;until:number;report:DetailedAiReport}|undefined;
export async function createDetailedAiReport(plan:TradePlan):Promise<DetailedAiResult>{
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!apiKey)return {report:null,status:{state:"fallback",code:"MISSING_API_KEY",
    message:"На сервері не налаштовано OPENAI_API_KEY. Технічний аналіз доступний без AI."}};
  const facts={
    symbol:plan.symbol,direction:plan.direction,source:"Bybit Demo scanner",
    price:plan.currentPrice,entry:plan.entryPrice,entryZone:[plan.entryLow,plan.entryHigh],
    stop:plan.stopLoss,target:plan.takeProfit2,rr:plan.riskReward,
    score:plan.score,readiness:plan.readiness,qualityGate:plan.qualityGate,
    structure:plan.structure,limitReach24h:plan.limitEntry24h,
    observation:plan.observation,expiresAt:plan.expiresAt,
    status:plan.status,technicalFacts:plan.reasons,
    invalidation:plan.invalidation,lifecycle:plan.lifecycle,
  };
  const key=JSON.stringify({model:MODEL,facts});
  if(saved?.key===key&&saved.until>Date.now())
    return {report:saved.report,status:{state:"cached",code:"CACHE_HIT",message:"AI-аналіз із кешу.",model:MODEL}};
  const schema={type:"object",additionalProperties:false,required:[...fields],properties:{
    marketContext:{type:"string"},entryLogic:{type:"string"},
    confirmationConditions:{type:"array",items:{type:"string"}},
    invalidation:{type:"string"},riskAnalysis:{type:"string"},
    beginnerExplanation:{type:"string"},nextAction:{type:"string"},
  }};
  try{
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",cache:"no-store",signal:AbortSignal.timeout(20000),
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},
      body:JSON.stringify({model:MODEL,store:false,
        input:[
          {role:"developer",content:`Ти навчальний аналітичний помічник Alpha Pulse. Пояснюй українською докладно, але читабельно, тільки з наданих фактів, без припущень про невідомі графіки/обсяги/новини. У тебе НЕМАЄ незалежного ринкового доступу. Розрізняй статус ACTIVE, qualityGate.passed та фактичний дозвіл на ручну заявку. Якщо умови не виконані, обов'язково скажи, що це сценарій спостереження, НЕ готовий сигнал. Зазнач конкретні невиконані умови та що має змінитися для переоцінки (але не вигадуй числові тригери). Поясни Entry, обмеження TP, Stop Loss, ризик виконання Limit, ризик збитку та відмінність 24-годинного пошуку Entry від життя GTC ордера. Score і історичні частоти торкань НЕ є шансом прибутку чи виконання. Не давай імперативного наказу торгувати. Не змінюй ціни та не придумуй відсотків. confirmationConditions має містити 3–8 фактичних конкретних умов, зі статусом кожної. Відповіді 2–5 речень на поле, beginnerExplanation — зрозуміла новачку аналогія без обіцянок.`},
          {role:"user",content:JSON.stringify(facts)},
        ],text:{format:{type:"json_schema",name:"alpha_pulse_detail",strict:true,schema}},
        max_output_tokens:3000}),
    });
    if(!response.ok)return {report:null,status:{state:"fallback",code:`OPENAI_HTTP_${response.status}`,
      message:response.status===401?"OpenAI не прийняв API-ключ.":
        response.status===429?"Досягнуто ліміту OpenAI.":"AI-провайдер наразі недоступний."}};
    const data=await response.json() as Parameters<typeof parseOutput>[0];
    const parsed=JSON.parse(parseOutput(data)) as unknown;
    if(!valid(parsed))throw Error("INVALID_AI_RESPONSE");
    saved={key,until:Date.now()+120000,report:parsed};
    return {report:parsed,status:{state:"ok",code:"AI_SUCCESS",message:"Розгорнутий AI-аналіз отримано.",model:MODEL}};
  }catch(error){
    const timeout=error instanceof Error&&["TimeoutError","AbortError"].includes(error.name);
    return {report:null,status:{state:"fallback",code:timeout?"TIMEOUT":"AI_UNAVAILABLE",
      message:timeout?"OpenAI не відповів протягом 20 секунд.":"Не вдалося отримати перевірену структуровану відповідь AI."}};
  }
}
