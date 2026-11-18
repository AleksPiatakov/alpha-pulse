import { NextResponse } from "next/server";
import { verifyCurrentTechnicalPlan } from "@/lib/market-scan";
import { createDetailedAiReport } from "@/lib/ai-detailed-analysis";

// Research display only; this endpoint never creates or changes orders.
export async function GET(request: Request, context: {params: Promise<{symbol:string}>}) {
  const {symbol:raw}=await context.params;
  const symbol=raw.toUpperCase();
  if(!/^[A-Z0-9]{3,24}USDT$/.test(symbol))
    return NextResponse.json({success:false,error:"Некоректний інструмент."},{status:400});
  try{
    const plan=await verifyCurrentTechnicalPlan(symbol);
    if(!plan)
      return NextResponse.json({success:true,plan:null,verified:false,
        aiStatus:{state:"no_plans",code:"NO_CURRENT_PLAN",message:"На поточних даних немає перевіреного сценарію."}},
        {headers:{"Cache-Control":"no-store"}});
    const wantAi=new URL(request.url).searchParams.get("ai")==="1";
    const ai=wantAi?await createDetailedAiReport(plan):null;
    return NextResponse.json({
      success:true,verified:true,plan,
      aiExplanation:ai?.report??null,
      aiStatus:ai?.status??{state:"not_requested",code:"ON_DEMAND",message:"AI-аналіз запускається вручну."},
      observedAt:plan.observation?.observedAt??null,orderEnabled:false,
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({success:false,error:error instanceof Error?error.message:"Немає доступу до поточних даних Bybit."},
      {status:502,headers:{"Cache-Control":"no-store"}});
  }
}
