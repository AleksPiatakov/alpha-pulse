import { NextResponse } from "next/server";
import { createAiExplanations } from "@/lib/ai-explanations";
import { scanTechnicalPlans } from "@/lib/market-scan";

export async function GET() {
  try {
    const { plans, scanned, eligible, analyzed, rejectionCounts } = await scanTechnicalPlans();
    const ai = await createAiExplanations(plans);
    const enrichedPlans = plans.map((plan) =>
      ai.explanations[plan.id]
        ? { ...plan, ...ai.explanations[plan.id], explanationSource: "ai" as const }
        : plan
    );
    return NextResponse.json({
      success: true, scanned, eligible, analyzed, rejectionCounts,
      plans: enrichedPlans, aiStatus: ai.status,
      generatedAt: new Date().toISOString(),
    });
  } catch (caught) {
    return NextResponse.json({
      success: false,
      error: caught instanceof Error ? caught.message : "Помилка сканування.",
    }, { status: 502 });
  }
}
