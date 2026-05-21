import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export type AiProvider = "claude" | "codex" | "codex-cli";

export interface ApiSettings {
  provider?: AiProvider;
  api_key?: string;
  base_url?: string;
  model?: string;
  max_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh";
}

export interface LlmClient {
  provider: AiProvider;
  model: string;
  reasoningEffort?: string;
  generateText(prompt: string, maxTokens: number): Promise<string>;
}

const DEFAULT_API_KEY = "YOUR_API_KEY";
const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_CODEX_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const DEFAULT_CODEX_CLI_MODEL = "gpt-5.5";
const DEFAULT_CODEX_CLI_REASONING_EFFORT = "xhigh";

const SETTINGS_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "..",
  "data",
  "api_settings.json"
);

let _cachedSettings: ApiSettings | null = null;

function normalizeProvider(provider?: string): AiProvider {
  if (provider === "codex-cli") return "codex-cli";
  return provider === "codex" ? "codex" : "claude";
}

function defaultModel(provider: AiProvider): string {
  if (provider === "codex-cli") return DEFAULT_CODEX_CLI_MODEL;
  return provider === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL;
}

function defaultBaseUrl(provider: AiProvider): string {
  if (provider === "codex-cli") return "";
  return provider === "codex" ? DEFAULT_CODEX_BASE_URL : DEFAULT_CLAUDE_BASE_URL;
}

export function getProviderDefaults(provider: AiProvider): {
  model: string;
  base_url: string;
} {
  return {
    model: defaultModel(provider),
    base_url: defaultBaseUrl(provider),
  };
}

async function loadApiSettings(): Promise<ApiSettings> {
  if (_cachedSettings) return _cachedSettings;
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf-8");
    _cachedSettings = JSON.parse(raw);
    return _cachedSettings!;
  } catch {
    return {};
  }
}

export async function saveApiSettings(settings: ApiSettings) {
  const dir = path.dirname(SETTINGS_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  _cachedSettings = settings;
}

export async function getApiSettings(): Promise<ApiSettings> {
  return loadApiSettings();
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function extractAnthropicText(response: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const parts: string[] = [];
  for (const item of response.content) {
    if (item.type === "text" && item.text) {
      parts.push(item.text);
    }
  }
  return parts.join("\n").trim();
}

async function fetchJson(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown; errorText: string }> {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body: unknown = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    errorText: raw,
  };
}

function extractOpenAIResponsesText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text.trim();

  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    const content = Array.isArray(itemRecord.content)
      ? itemRecord.content
      : [];
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const contentRecord = contentItem as Record<string, unknown>;
      if (typeof contentRecord.text === "string") {
        parts.push(contentRecord.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractChatCompletionsText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content.trim() : "";
}

function openAIErrorMessage(body: unknown, errorText: string): string {
  if (body && typeof body === "object") {
    const error = (body as Record<string, unknown>).error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
  }
  return errorText || "OpenAI-compatible request failed";
}

async function requestCodexText(
  baseURL: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const root = trimTrailingSlash(baseURL);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const responses = await fetchJson(`${root}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: maxTokens,
    }),
  });

  if (responses.ok) {
    const text = extractOpenAIResponsesText(responses.body);
    if (text) return text;
    throw new Error("Codex response did not contain text output");
  }

  if (![404, 405].includes(responses.status)) {
    throw new Error(openAIErrorMessage(responses.body, responses.errorText));
  }

  const chat = await fetchJson(`${root}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!chat.ok) {
    throw new Error(openAIErrorMessage(chat.body, chat.errorText));
  }

  const text = extractChatCompletionsText(chat.body);
  if (!text) throw new Error("Codex chat response did not contain text output");
  return text;
}

async function requestCodexCliText(
  model: string,
  reasoningEffort: string,
  prompt: string
): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `evil-read-arxiv-codex-${randomUUID()}.txt`);
  const command = process.env.CODEX_CLI_BIN || "codex";
  const timeoutMs = Number(process.env.CODEX_CLI_TIMEOUT_MS || 120000);
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "--output-last-message",
    outputPath,
  ];

  if (model) {
    args.push("--model", model);
  }
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
  }
  args.push("-");

  const backendPrompt = `You are a backend text generation adapter for a paper-reading app. Return only the requested answer. Do not inspect files, run commands, or describe your process.\n\n${prompt}`;

  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(command, args, {
          cwd: process.cwd(),
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(
              new Error(
                `Codex CLI exited with code ${code}: ${stderr || stdout || "no output"}`
              )
            );
          }
        });

        child.stdin.end(backendPrompt);
      }
    );

    const text = (await fs.readFile(outputPath, "utf-8").catch(() => "")).trim();
    if (text) return text;
    const fallback = stdout.trim();
    if (fallback) return fallback;
    throw new Error(`Codex CLI did not produce text output: ${stderr || "no stderr"}`);
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}

export async function createLlmClientWithSettings(): Promise<LlmClient> {
  const settings = await loadApiSettings();
  const provider = normalizeProvider(settings.provider || process.env.AI_PROVIDER);
  const model = settings.model || process.env.AI_MODEL || defaultModel(provider);
  const reasoningEffort =
    settings.reasoning_effort ||
    process.env.AI_REASONING_EFFORT ||
    (provider === "codex-cli" ? DEFAULT_CODEX_CLI_REASONING_EFFORT : undefined);

  if (provider === "codex-cli") {
    return {
      provider,
      model,
      reasoningEffort,
      generateText: (prompt) =>
        requestCodexCliText(model, reasoningEffort || "", prompt),
    };
  }

  if (provider === "codex") {
    const apiKey =
      settings.api_key ||
      process.env.OPENAI_API_KEY ||
      process.env.CODEX_API_KEY ||
      DEFAULT_API_KEY;

    const baseURL =
      settings.base_url ||
      process.env.OPENAI_BASE_URL ||
      process.env.CODEX_BASE_URL ||
      defaultBaseUrl(provider);

    return {
      provider,
      model,
      generateText: (prompt, maxTokens) =>
        requestCodexText(baseURL, apiKey, model, prompt, maxTokens),
    };
  }

  const token =
    settings.api_key ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY ||
    DEFAULT_API_KEY;

  const baseURL =
    settings.base_url ||
    process.env.ANTHROPIC_BASE_URL ||
    defaultBaseUrl(provider);

  const client = token.startsWith("sk-ant-")
    ? new Anthropic({ apiKey: token, authToken: null, baseURL })
    : new Anthropic({
        authToken: token,
        apiKey: null,
        baseURL,
      } as ConstructorParameters<typeof Anthropic>[0]);

  return {
    provider,
    model,
    generateText: async (prompt, maxTokens) => {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      return extractAnthropicText(response);
    },
  };
}
