import { NextRequest, NextResponse } from "next/server";
import { createLlmClientWithSettings } from "@/lib/llm";
import { getCachedPapers, getFeedback, mergeFeedback, getResearchConfig } from "@/lib/data";
import type { Paper } from "@/lib/types";
import { type Language, prompts } from "@/lib/i18n";

export async function POST(request: NextRequest) {
  try {
    const { date, focus } = await request.json();

    if (!focus || !focus.trim()) {
      return NextResponse.json(
        { error: "Focus keywords required" },
        { status: 400 }
      );
    }

    const cached = await getCachedPapers(date);
    if (!cached) {
      return NextResponse.json(
        { error: "No cached papers for this date. Search first." },
        { status: 404 }
      );
    }

    const client = await createLlmClientWithSettings();
    const config = await getResearchConfig();
    const lang: Language = config.language === "en" ? "en" : "zh";

    const paperList = cached.papers
      .map(
        (p: Paper, i: number) =>
          `[${i}] ${p.title}\n${p.summary}`
      )
      .join("\n\n");

    const text = await client.generateText(
      prompts.filter[lang](focus, paperList),
      1024
    );

    let rankings: { index: number; score: number }[];
    try {
      rankings = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      rankings = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    const sortedPapers = rankings
      .sort((a, b) => b.score - a.score)
      .map((r) => cached.papers[r.index])
      .filter(Boolean);

    const rankedIds = new Set(sortedPapers.map((p: Paper) => p.arxiv_id));
    const remaining = cached.papers.filter(
      (p: Paper) => !rankedIds.has(p.arxiv_id)
    );

    const allPapers = [...sortedPapers, ...remaining];

    const feedback = await getFeedback();
    const papersWithFeedback = mergeFeedback(allPapers, feedback);

    return NextResponse.json({
      date: cached.date,
      papers: papersWithFeedback,
      total: papersWithFeedback.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Filter failed: ${message}` },
      { status: 500 }
    );
  }
}
