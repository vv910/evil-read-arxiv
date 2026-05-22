import { NextRequest, NextResponse } from "next/server";
import { getResearchConfig, saveResearchConfig } from "@/lib/data";
import {
  getApiSettings,
  getProviderDefaults,
  saveApiSettings,
  type AiProvider,
} from "@/lib/llm";
import type { AiSettings, AppSettings } from "@/lib/types";

function normalizeProvider(provider?: string): AiProvider {
  if (provider === "codex-cli") return "codex-cli";
  return provider === "codex" ? "codex" : "claude";
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.includes("...")) return key;
  return key.length > 11 ? `${key.slice(0, 7)}...${key.slice(-4)}` : "****";
}

export async function GET() {
  try {
    const research = await getResearchConfig();
    const apiSettings = await getApiSettings();
    const provider = normalizeProvider(apiSettings.provider || process.env.AI_PROVIDER);
    const defaults = getProviderDefaults(provider);
    const envBaseUrl =
      provider === "codex"
        ? process.env.OPENAI_BASE_URL || process.env.CODEX_BASE_URL
        : provider === "claude"
          ? process.env.ANTHROPIC_BASE_URL
          : "";

    const ai: AiSettings = {
      provider,
      model: apiSettings.model || process.env.AI_MODEL || defaults.model,
      api_key: apiSettings.api_key || "",
      base_url: apiSettings.base_url || envBaseUrl || defaults.base_url,
      max_tokens: apiSettings.max_tokens || 4096,
      reasoning_effort:
        apiSettings.reasoning_effort ||
        (process.env.AI_REASONING_EFFORT as AiSettings["reasoning_effort"]) ||
        (provider === "codex-cli" ? "xhigh" : undefined),
    };

    const settings: AppSettings = {
      ai,
      claude: {
        model: provider === "claude" ? ai.model : getProviderDefaults("claude").model,
        api_key: provider === "claude" ? ai.api_key : "",
        max_tokens: ai.max_tokens,
      },
      research,
      general: {
        language: research.language || "zh",
        daily_paper_count: 10,
        obsidian_sync: !!research.vault_path,
        semantic_scholar_api_key: research.semantic_scholar_api_key || "",
      },
    };

    // Mask API keys for display.
    settings.ai.api_key = maskKey(settings.ai.api_key);
    settings.claude.api_key = maskKey(settings.claude.api_key);

    return NextResponse.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to read settings: ${message}` },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.research) {
      await saveResearchConfig(body.research);
    }

    if (body.ai || body.claude) {
      const current = await getApiSettings();
      const updated = { ...current };
      const incoming = body.ai || body.claude;

      if (incoming.provider) {
        updated.provider = normalizeProvider(incoming.provider);
      }
      if (incoming.model) {
        updated.model = incoming.model;
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "api_key")) {
        if (incoming.api_key && !incoming.api_key.includes("...")) {
          updated.api_key = incoming.api_key;
        } else if (incoming.api_key === "") {
          delete updated.api_key;
        }
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "base_url")) {
        if (incoming.base_url) {
          updated.base_url = incoming.base_url;
        } else {
          delete updated.base_url;
        }
      }
      if (incoming.max_tokens) {
        updated.max_tokens = incoming.max_tokens;
      }
      if (incoming.reasoning_effort) {
        updated.reasoning_effort = incoming.reasoning_effort;
      }

      await saveApiSettings(updated);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to save settings: ${message}` },
      { status: 500 }
    );
  }
}
