#!/usr/bin/env tsx
/**
 * GEPA Training Script — Optimizes coding agent prompts per model
 *
 * Usage:
 *   # Start the Ax optimizer service first:
 *   cd node_modules/@ax-llm/ax/src/optimizer && uv sync && uv run ax-optimizer server start
 *
 *   # Then run training:
 *   npm run train
 *
 * This trains GEPA on a coding agent task:
 * - Metric: tool calling correctness + autonomous flow capability
 * - Output: optimizations/<model-id>.json
 */

import { ai, ax, AxGEPA, type AxAIOpenAIModel } from "@ax-llm/ax";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIMIZATIONS_DIR = join(__dirname, "..", "optimizations");

// =============================================================================
// Training Examples — Coding agent tool-calling scenarios
// =============================================================================

const examples = [
  {
    task: "Read the file src/index.ts and tell me what it exports",
    expectedTools: ["read"],
    expectedFlow: "single-tool",
  },
  {
    task: "Find all TypeScript files that import 'express' and show the first 10 lines of each",
    expectedTools: ["grep", "read"],
    expectedFlow: "multi-tool-sequential",
  },
  {
    task: "Create a new file src/utils/helpers.ts with a debounce function",
    expectedTools: ["write"],
    expectedFlow: "single-tool",
  },
  {
    task: "Run the test suite and fix any failing tests",
    expectedTools: ["bash", "read", "edit"],
    expectedFlow: "iterative-fix",
  },
  {
    task: "Refactor the function processData in src/core.ts to use async/await instead of callbacks",
    expectedTools: ["read", "edit"],
    expectedFlow: "read-then-edit",
  },
  {
    task: "List all files in the project root and check if there's a .env.example file",
    expectedTools: ["ls", "read"],
    expectedFlow: "multi-tool-sequential",
  },
  {
    task: "Search for TODO comments across the codebase and create a summary",
    expectedTools: ["grep"],
    expectedFlow: "single-tool",
  },
  {
    task: "Install the zod package and add a validation schema for the User type in src/types.ts",
    expectedTools: ["bash", "read", "edit"],
    expectedFlow: "multi-tool-sequential",
  },
];

// =============================================================================
// Multi-Objective Metric
// =============================================================================

const metric = ({
  prediction,
  example,
}: {
  prediction: Record<string, unknown>;
  example: (typeof examples)[0];
}) => {
  // Objective 1: Tool selection correctness
  const predictedTools = (prediction.toolsUsed as string[] | undefined) ?? [];
  const expectedSet = new Set(example.expectedTools);
  const predictedSet = new Set(predictedTools);
  const intersection = [...expectedSet].filter((t) => predictedSet.has(t));
  const toolAccuracy =
    expectedSet.size > 0 ? intersection.length / expectedSet.size : 0;

  // Objective 2: No hallucinated tools
  const extraTools = [...predictedSet].filter((t) => !expectedSet.has(t));
  const toolPrecision =
    predictedSet.size > 0
      ? (predictedSet.size - extraTools.length) / predictedSet.size
      : 1;

  // Objective 3: Flow correctness (did it follow the right pattern?)
  const flowCorrect =
    prediction.flowPattern === example.expectedFlow ? 1 : 0.5;

  return {
    toolRecall: toolAccuracy,
    toolPrecision,
    flowCorrectness: flowCorrect,
  } as Record<string, number>;
};

// =============================================================================
// Training Loop
// =============================================================================

async function train() {
  const modelName = process.argv[2] ?? "gpt-4o-mini";
  console.log(`🔄 Training GEPA optimization for model: ${modelName}`);

  const llm = ai({
    name: "openai",
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: modelName as AxAIOpenAIModel },
  });

  // Define the coding agent signature
  const codingAgent = ax(`
    task:string "A coding task to complete" ->
    toolsUsed:string[] "List of tools that should be used",
    flowPattern:class "single-tool, multi-tool-sequential, read-then-edit, iterative-fix" "The execution pattern",
    reasoning:string "Brief explanation of approach"
  `);

  const optimizer = new AxGEPA({
    studentAI: llm,
    numTrials: 20,
    minibatch: true,
    minibatchSize: 6,
    seed: 42,
    verbose: true,
    earlyStoppingTrials: 5,
  });

  console.log("🧬 Starting GEPA multi-objective optimization...");
  const result = await optimizer.compile(
    codingAgent as any,
    examples,
    metric as any,
    {
      maxMetricCalls: 200,
      validationExamples: examples.slice(0, 4),
    }
  );

  console.log(`\n✅ Training complete!`);
  console.log(`   Pareto front size: ${result.paretoFrontSize}`);
  console.log(`   Best score: ${result.bestScore?.toFixed(3)}`);
  console.log(`   Hypervolume: ${result.hypervolume ?? "N/A"}`);

  // Save optimization
  if (result.optimizedProgram) {
    mkdirSync(OPTIMIZATIONS_DIR, { recursive: true });
    const outputPath = join(
      OPTIMIZATIONS_DIR,
      `${modelName.replace(/[/\\:]/g, "-")}.json`
    );

    const data = {
      version: "2.0",
      modelId: modelName,
      bestScore: result.optimizedProgram.bestScore,
      instruction: result.optimizedProgram.instruction,
      demos: result.optimizedProgram.demos,
      modelConfig: result.optimizedProgram.modelConfig,
      optimizerType: result.optimizedProgram.optimizerType,
      optimizationTime: result.optimizedProgram.optimizationTime,
      totalRounds: result.optimizedProgram.totalRounds,
      converged: result.optimizedProgram.converged,
      stats: result.optimizedProgram.stats,
      trainedAt: new Date().toISOString(),
      trainingExamples: examples.length,
    };

    writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\n💾 Saved to ${outputPath}`);
  }
}

train().catch(console.error);
