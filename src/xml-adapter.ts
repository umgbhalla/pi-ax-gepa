/**
 * XML ↔ JSON tool conversion adapter
 *
 * Converts Pi's JSON tool definitions to XML format for system prompt injection,
 * and parses XML tool calls from model responses back to Pi's internal format.
 */

export interface JsonTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

// =============================================================================
// JSON Tools → XML Definitions (for system prompt injection)
// =============================================================================

function schemaPropertyToXml(
  name: string,
  prop: JsonSchemaProperty,
  indent: string,
  required: boolean
): string {
  const lines: string[] = [];
  const reqAttr = required ? ' required="true"' : "";
  const typeAttr = ` type="${prop.type}"`;

  if (prop.type === "object" && prop.properties) {
    lines.push(`${indent}<${name}${typeAttr}${reqAttr}>`);
    const childRequired = new Set(prop.required ?? []);
    for (const [childName, childProp] of Object.entries(prop.properties)) {
      lines.push(
        schemaPropertyToXml(
          childName,
          childProp,
          indent + "  ",
          childRequired.has(childName)
        )
      );
    }
    lines.push(`${indent}</${name}>`);
  } else if (prop.type === "array" && prop.items) {
    lines.push(
      `${indent}<${name}${typeAttr}${reqAttr} items="${prop.items.type}">`
    );
    if (prop.description) {
      lines.push(`${indent}  <!-- ${prop.description} -->`);
    }
    lines.push(`${indent}</${name}>`);
  } else {
    const enumAttr = prop.enum ? ` values="${prop.enum.join(",")}"` : "";
    const desc = prop.description ? ` — ${prop.description}` : "";
    lines.push(
      `${indent}<${name}${typeAttr}${reqAttr}${enumAttr}>${desc}</${name}>`
    );
  }

  return lines.join("\n");
}

export function toolsToXml(tools: JsonTool[]): string {
  const lines: string[] = [];

  for (const tool of tools) {
    lines.push(`<tool name="${tool.name}">`);
    lines.push(`  <description>${tool.description}</description>`);

    if (tool.input_schema.properties) {
      lines.push("  <parameters>");
      const required = new Set(tool.input_schema.required ?? []);
      for (const [paramName, paramSchema] of Object.entries(
        tool.input_schema.properties
      )) {
        lines.push(
          schemaPropertyToXml(
            paramName,
            paramSchema,
            "    ",
            required.has(paramName)
          )
        );
      }
      lines.push("  </parameters>");
    }

    lines.push("</tool>");
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// XML Tool Calls → JSON (parsing model responses)
// =============================================================================

/**
 * Parse XML tool calls from model text response.
 *
 * Expected format:
 * <tool_call>
 * <tool name="tool_name">
 * <param1>value1</param1>
 * <param2>value2</param2>
 * </tool>
 * </tool_call>
 */
export function parseXmlToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // Match tool_call blocks
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;

  while ((match = toolCallRegex.exec(text)) !== null) {
    const block = match[1];

    // Extract tool name
    const nameMatch = block.match(/<tool\s+name="([^"]+)">/);
    if (!nameMatch) continue;

    const toolName = nameMatch[1];
    const args: Record<string, unknown> = {};

    // Extract parameters — everything between <tool name="..."> and </tool>
    const toolBodyMatch = block.match(
      /<tool\s+name="[^"]+">\s*([\s\S]*?)\s*<\/tool>/
    );
    if (toolBodyMatch) {
      const body = toolBodyMatch[1];

      // Parse simple <param>value</param> pairs
      const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(body)) !== null) {
        const paramName = paramMatch[1];
        const paramValue = paramMatch[2].trim();

        // Try to parse as JSON for complex values
        try {
          args[paramName] = JSON.parse(paramValue);
        } catch {
          // Keep as string
          args[paramName] = paramValue;
        }
      }
    }

    calls.push({ name: toolName, arguments: args });
  }

  return calls;
}

/**
 * Check if text contains any XML tool calls.
 */
export function hasXmlToolCalls(text: string): boolean {
  return /<tool_call>/.test(text);
}

/**
 * Extract non-tool-call text from a response that contains XML tool calls.
 */
export function extractTextWithoutToolCalls(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .trim();
}
