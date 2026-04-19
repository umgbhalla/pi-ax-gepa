/**
 * Loads GEPA-optimized prompts per model from the optimizations/ directory.
 *
 * File naming convention:
 *   optimizations/<model-id>.json   — exact model match
 *   optimizations/<family>.json     — family fallback (e.g., "claude-sonnet.json")
 *
 * Each file follows Ax's AxOptimizedProgram format:
 * {
 *   "version": "2.0",
 *   "bestScore": 0.95,
 *   "instruction": "...",
 *   "demos": [...],
 *   "modelConfig": { ... },
 *   "optimizerType": "GEPA",
 *   ...
 * }
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DemoTrace {
  traces?: Array<Record<string, unknown>>;
  instruction?: string;
}

export interface ModelOptimization {
  modelId: string;
  bestScore: number;
  instruction: string | null;
  demos: DemoTrace[] | null;
  modelConfig: Record<string, unknown> | null;
  optimizerType: string;
  converged: boolean;
  raw: Record<string, unknown>;
}

// Model family patterns for fallback matching
const MODEL_FAMILIES: Record<string, string[]> = {
  "claude-sonnet": ["claude-sonnet", "claude-4-sonnet", "claude-3.5-sonnet"],
  "claude-opus": ["claude-opus", "claude-4-opus"],
  "claude-haiku": ["claude-haiku", "claude-4-haiku"],
  "gpt-5": ["gpt-5", "gpt-5.2", "gpt-5.3", "gpt-5.4"],
  "gpt-4o": ["gpt-4o", "gpt-4o-mini"],
  "qwen": ["qwen", "qwen3", "qwen2.5"],
  "gemini": ["gemini", "gemini-2", "gemini-3"],
  "codex": ["codex", "gpt-5.2-codex", "gpt-5.3-codex"],
};

/**
 * Find the model family name for fallback matching.
 */
function findFamily(modelId: string): string | null {
  const lower = modelId.toLowerCase();
  for (const [family, patterns] of Object.entries(MODEL_FAMILIES)) {
    if (patterns.some((p) => lower.includes(p))) {
      return family;
    }
  }
  return null;
}

/**
 * Sanitize model ID to filesystem-safe name.
 */
function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[/\\:]/g, "-").toLowerCase();
}

/**
 * Load optimization for a specific model, with family fallback.
 */
export function loadOptimization(
  dir: string,
  modelId: string
): ModelOptimization | null {
  if (!existsSync(dir)) return null;

  // 1. Try exact match
  const exactPath = join(dir, `${sanitizeModelId(modelId)}.json`);
  if (existsSync(exactPath)) {
    return parseOptimization(exactPath, modelId);
  }

  // 2. Try family fallback
  const family = findFamily(modelId);
  if (family) {
    const familyPath = join(dir, `${family}.json`);
    if (existsSync(familyPath)) {
      return parseOptimization(familyPath, modelId);
    }
  }

  // 3. Try default
  const defaultPath = join(dir, "default.json");
  if (existsSync(defaultPath)) {
    return parseOptimization(defaultPath, modelId);
  }

  return null;
}

/**
 * List all available optimizations.
 */
export function listOptimizations(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

function parseOptimization(
  path: string,
  modelId: string
): ModelOptimization | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return {
      modelId,
      bestScore: raw.bestScore ?? 0,
      instruction: raw.instruction ?? null,
      demos: raw.demos ?? null,
      modelConfig: raw.modelConfig ?? null,
      optimizerType: raw.optimizerType ?? "unknown",
      converged: raw.converged ?? false,
      raw,
    };
  } catch (err) {
    console.error(`Failed to parse GEPA optimization at ${path}:`, err);
    return null;
  }
}
