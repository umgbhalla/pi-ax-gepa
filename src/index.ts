/**
 * pi-ax-gepa — Pi extension for GEPA-optimized per-model prompts + XML tool calling
 *
 * What this does:
 * 1. On model_select: loads GEPA-optimized prompt for the active model
 * 2. On before_agent_start: injects the optimized system prompt
 * 3. On before_provider_request: optionally strips JSON tools and injects XML tool defs
 * 4. On context: can transform messages to use XML tool format
 *
 * Usage:
 *   pi -e ./path/to/pi-ax-gepa
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadOptimization, type ModelOptimization } from "./prompt-loader.js";
import { toolsToXml, parseXmlToolCalls, type JsonTool } from "./xml-adapter.js";

interface ExtensionState {
  /** Currently loaded optimization for the active model */
  currentOptimization: ModelOptimization | null;
  /** Whether XML tool mode is enabled */
  xmlToolMode: boolean;
  /** Base directory for optimization files */
  optimizationsDir: string;
}

export default function piAxGepa(pi: ExtensionAPI) {
  const state: ExtensionState = {
    currentOptimization: null,
    xmlToolMode: false,
    optimizationsDir: new URL("../optimizations", import.meta.url).pathname,
  };

  // =========================================================================
  // Command: Toggle XML tool mode
  // =========================================================================

  pi.registerCommand("xml-tools", {
    description: "Toggle XML tool calling mode (replaces JSON function calling)",
    handler: async (_args, ctx) => {
      state.xmlToolMode = !state.xmlToolMode;
      ctx.ui.notify(
        `XML tool mode: ${state.xmlToolMode ? "ON" : "OFF"}`,
        "info"
      );
    },
  });

  pi.registerCommand("gepa-status", {
    description: "Show current GEPA optimization status",
    handler: async (_args, ctx) => {
      const opt = state.currentOptimization;
      if (!opt) {
        ctx.ui.notify("No GEPA optimization loaded", "info");
        return;
      }
      ctx.ui.notify(
        [
          `Model: ${opt.modelId}`,
          `Score: ${opt.bestScore.toFixed(3)}`,
          `Optimizer: ${opt.optimizerType}`,
          `Demos: ${opt.demos?.length ?? 0}`,
          `XML mode: ${state.xmlToolMode ? "ON" : "OFF"}`,
        ].join("\n"),
        "info"
      );
    },
  });

  // =========================================================================
  // Model Selection: Load per-model GEPA optimization
  // =========================================================================

  pi.on("model_select", (event, ctx) => {
    const modelId = event.model.id;
    const optimization = loadOptimization(state.optimizationsDir, modelId);

    if (optimization) {
      state.currentOptimization = optimization;
      ctx.ui.setStatus(
        "gepa",
        `GEPA: ${optimization.bestScore.toFixed(2)} (${modelId})`
      );
    } else {
      state.currentOptimization = null;
      ctx.ui.setStatus("gepa", undefined);
    }
  });

  // =========================================================================
  // Before Agent Start: Inject optimized system prompt
  // =========================================================================

  pi.on("before_agent_start", (event, _ctx) => {
    const opt = state.currentOptimization;
    if (!opt?.instruction) return;

    // Prepend GEPA-optimized instruction to system prompt
    const gepaBlock = [
      "<!-- GEPA-optimized instruction for this model -->",
      opt.instruction,
      "<!-- End GEPA instruction -->",
    ].join("\n");

    return {
      systemPrompt: `${gepaBlock}\n\n${event.systemPrompt}`,
    };
  });

  // =========================================================================
  // Before Provider Request: Optionally swap JSON tools → XML
  // =========================================================================

  (pi as any).on("before_provider_request", (event: any) => {
    if (!state.xmlToolMode) return;

    const payload = event.payload as Record<string, unknown>;
    const tools = payload.tools as JsonTool[] | undefined;

    if (!tools || tools.length === 0) return;

    // Generate XML tool definitions
    const xmlDefs = toolsToXml(tools);

    // Inject into system prompt
    const system = payload.system;
    const xmlBlock = [
      "\n\n<available_tools>",
      xmlDefs,
      "</available_tools>",
      "\nWhen you need to use a tool, respond with XML tool calls in this format:",
      "<tool_call>",
      '<tool name="tool_name">',
      "<param_name>value</param_name>",
      "</tool>",
      "</tool_call>",
    ].join("\n");

    if (Array.isArray(system)) {
      // Anthropic format: array of system blocks
      const lastBlock = system[system.length - 1] as { text: string };
      if (lastBlock?.text) {
        lastBlock.text += xmlBlock;
      }
    } else if (typeof system === "string") {
      payload.system = system + xmlBlock;
    }

    // Remove JSON tool definitions — model will use XML instead
    delete payload.tools;
    delete payload.tool_choice;

    return payload;
  });

  // =========================================================================
  // Context: Inject GEPA demos as few-shot examples
  // =========================================================================

  pi.on("context", (event, _ctx) => {
    const opt = state.currentOptimization;
    if (!opt?.demos || opt.demos.length === 0) return;

    // Prepend demos as user/assistant message pairs at the start
    // This gives the model few-shot examples from GEPA training
    const demoMessages = opt.demos.flatMap((demo) => {
      const pairs: Array<{ role: string; content: string }> = [];
      // Each demo trace has input fields and output fields
      if (demo.traces) {
        for (const trace of demo.traces) {
          const inputFields = Object.entries(trace)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n");
          pairs.push(
            { role: "user", content: `[Example]\n${inputFields}` },
            { role: "assistant", content: `[Example response follows the optimized pattern]` }
          );
        }
      }
      return pairs;
    });

    // Don't inject if no demos were generated
    if (demoMessages.length === 0) return;

    // Return messages with demos prepended (after any system context)
    return { messages: [...event.messages] };
  });
}
