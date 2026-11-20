import {NextResponse} from "next/server";
import {readScenarioHistory} from "@/lib/scenario-event-journal";

export async function GET(request:Request){
  const url=new URL(request.url);
  const symbol=(url.searchParams.get("symbol")??"").trim().toUpperCase();
  if(symbol&&!/^[A-Z0-9]{3,24}USDT$/.test(symbol))
    return NextResponse.json({success:false,error:"Некоректна торгова пара."},{status:400});
  const limitParam=Number(url.searchParams.get("limit")??"100");
  if(!Number.isInteger(limitParam)||limitParam<1||limitParam>200)
    return NextResponse.json({success:false,error:"Некоректна кількість подій."},{status:400});
  try{
    const events=await readScenarioHistory(symbol||undefined,limitParam);
    return NextResponse.json({success:true,events,orderEnabled:false},{
      headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({
      success:false,error:error instanceof Error?error.message:"Історія зараз недоступна.",
    },{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
