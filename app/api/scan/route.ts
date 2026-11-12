import { NextResponse } from "next/server";
import { createAiExplanations } from "@/lib/ai-explanations";
import { scanTechnicalPlans } from "@/lib/market-scan";

export async function GET() {
  try {
    const { plans, scanned, eligible, analyzed, covered, category, rejectionCounts,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted } = await scanTechnicalPlans();
    const ai = await createAiExplanations(plans.slice(0, 6));
    const enrichedPlans = plans.map((plan) =>
      ai.explanations[plan.id]
        ? { ...plan, ...ai.explanations[plan.id], explanationSource: "ai" as const }
        : plan
    );
    return NextResponse.json({
      success: true, scanned, eligible, analyzed, covered, category, rejectionCounts,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted,
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
