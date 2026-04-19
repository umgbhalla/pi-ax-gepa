# pi-ax-gepa

Pi extension that integrates [Ax](https://github.com/ax-llm/ax)'s GEPA optimizer with [Pi](https://github.com/badlogic/pi-mono)'s coding agent for per-model optimized prompts and XML tool calling.

## What it does

1. **Per-model GEPA prompts** — Train optimized system prompts for each LLM using Ax's GEPA multi-objective optimizer, load them automatically when switching models in Pi
2. **XML tool calling** — Optional mode that replaces JSON function calling with XML tool definitions, inspired by DSPy template patterns
3. **Few-shot demo injection** — GEPA-trained few-shot examples injected into context for improved tool selection accuracy

## Architecture

```
[GEPA trains optimal prompts per model]
        ↓ saves JSON to optimizations/
[Pi extension loads at runtime]
        ↓ model_select hook
[Swaps system prompt + few-shot demos]
        ↓ before_provider_request hook
[Optionally strips JSON tools, injects XML]
        ↓ Pi tool execution pipeline
[Everything downstream works normally]
```

## Quick Start

```bash
# Install
cd pi-ax-gepa
npm install

# Test the components
npm test

# Use with Pi
pi -e ./dist
```

## Training

```bash
# Start the Ax optimizer service
cd node_modules/@ax-llm/ax/src/optimizer
uv sync
uv run ax-optimizer server start --debug

# Train for a specific model
OPENAI_APIKEY=... npm run train -- gpt-4o-mini
ANTHROPIC_API_KEY=... npm run train -- claude-sonnet-4-5

# Optimizations saved to optimizations/<model>.json
```

## Commands

| Command | Description |
|---------|-------------|
| `/xml-tools` | Toggle XML tool calling mode |
| `/gepa-status` | Show current optimization status |

## File Structure

```
pi-ax-gepa/
├── src/
│   ├── index.ts           # Extension entry point
│   ├── xml-adapter.ts     # XML ↔ JSON tool conversion
│   └── prompt-loader.ts   # Loads per-model GEPA optimizations
├── scripts/
│   ├── train.ts           # GEPA training script
│   └── test-extension.ts  # Component tests
├── optimizations/         # Saved GEPA results (per model)
│   ├── claude-sonnet.json
│   ├── gpt-4o-mini.json
│   └── default.json       # Fallback optimization
└── package.json
```

## How optimization files work

Each file in `optimizations/` follows Ax's `AxOptimizedProgram` format:

```json
{
  "version": "2.0",
  "bestScore": 0.92,
  "instruction": "Optimized system prompt for this model...",
  "demos": [{ "traces": [...] }],
  "modelConfig": { "temperature": 0.3 },
  "optimizerType": "GEPA",
  "converged": true
}
```

Matching priority:
1. **Exact**: `optimizations/claude-sonnet-4-5.json`
2. **Family**: `optimizations/claude-sonnet.json` (matches any Sonnet variant)
3. **Default**: `optimizations/default.json`

## Based on

- [@anthonyronning's approach](https://x.com/anthonyronning/status/2042719791694385409) — Pi fork with Ax + GEPA per-model optimization
- [Ax GEPA docs](https://github.com/ax-llm/ax/blob/main/src/docs/src/content/docs/gepa.md) — Multi-objective optimization
- Pi's [extension system](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions) — hooks for model_select, before_agent_start, before_provider_request
