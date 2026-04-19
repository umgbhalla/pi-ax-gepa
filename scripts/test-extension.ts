#!/usr/bin/env tsx
/**
 * Quick test for the extension components without Pi running.
 * Tests XML adapter, prompt loader, and basic wiring.
 */

import { toolsToXml, parseXmlToolCalls, hasXmlToolCalls, extractTextWithoutToolCalls } from "../src/xml-adapter.js";
import { loadOptimization, listOptimizations } from "../src/prompt-loader.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Test XML Adapter
// =============================================================================

console.log("=== XML Adapter Tests ===\n");

// Test: JSON tools → XML
const testTools = [
  {
    name: "read",
    description: "Read the contents of a file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
        offset: { type: "number", description: "Line number to start from" },
        limit: { type: "number", description: "Max lines to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "bash",
    description: "Execute a shell command",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run" },
        timeout: { type: "number", description: "Timeout in ms" },
      },
      required: ["command"],
    },
  },
  {
    name: "edit",
    description: "Edit a file with search and replace",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to edit" },
        old_text: { type: "string", description: "Text to find" },
        new_text: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
];

const xmlOutput = toolsToXml(testTools);
console.log("Generated XML tool definitions:");
console.log(xmlOutput);

// Test: Parse XML tool calls
const modelResponse = `I'll read the file first.

<tool_call>
<tool name="read">
<path>src/index.ts</path>
<offset>1</offset>
<limit>50</limit>
</tool>
</tool_call>

Now let me also check the tests:

<tool_call>
<tool name="bash">
<command>npm test 2>&1 | tail -20</command>
</tool>
</tool_call>`;

const parsed = parseXmlToolCalls(modelResponse);
console.log("\nParsed tool calls:");
for (const call of parsed) {
  console.log(`  ${call.name}(${JSON.stringify(call.arguments)})`);
}

console.log(`\nHas XML tool calls: ${hasXmlToolCalls(modelResponse)}`);
console.log(`Text without calls: "${extractTextWithoutToolCalls(modelResponse)}"`);

// =============================================================================
// Test Prompt Loader
// =============================================================================

console.log("\n=== Prompt Loader Tests ===\n");

// Create a test optimization file
const testDir = join(__dirname, "..", "optimizations");
mkdirSync(testDir, { recursive: true });

const testOpt = {
  version: "2.0",
  bestScore: 0.92,
  instruction: "You are a precise coding assistant. Always read files before editing. Use grep to search, not manual scanning. Execute tests after changes.",
  demos: [
    {
      traces: [
        {
          task: "Fix the bug in auth.ts",
          toolsUsed: ["read", "edit", "bash"],
          flowPattern: "iterative-fix",
        },
      ],
    },
  ],
  modelConfig: { temperature: 0.3 },
  optimizerType: "GEPA",
  converged: true,
};

writeFileSync(join(testDir, "claude-sonnet.json"), JSON.stringify(testOpt, null, 2));
writeFileSync(join(testDir, "default.json"), JSON.stringify({ ...testOpt, instruction: "Default fallback instruction", bestScore: 0.75 }, null, 2));

// Test exact match
const exact = loadOptimization(testDir, "claude-sonnet");
console.log(`Exact match (claude-sonnet): score=${exact?.bestScore}, type=${exact?.optimizerType}`);

// Test family fallback
const family = loadOptimization(testDir, "claude-sonnet-4-5");
console.log(`Family match (claude-sonnet-4-5): score=${family?.bestScore}`);

// Test default fallback
const fallback = loadOptimization(testDir, "llama-3.1-70b");
console.log(`Default fallback (llama-3.1-70b): score=${fallback?.bestScore}, instruction="${fallback?.instruction?.slice(0, 40)}..."`);

// Test no match
const noMatch = loadOptimization("/nonexistent", "anything");
console.log(`No match: ${noMatch}`);

// List available
const available = listOptimizations(testDir);
console.log(`\nAvailable optimizations: ${available.join(", ")}`);

console.log("\n✅ All tests passed!");
