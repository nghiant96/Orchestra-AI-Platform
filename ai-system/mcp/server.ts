import { assertHermesAuth } from "./auth.js";
import { executeMcpTool, type McpToolContext, type McpToolName } from "./tools.js";

export interface McpToolRequest {
  name: McpToolName;
  input?: Record<string, unknown>;
  authToken?: string;
}

export async function handleMcpTool(ctx: McpToolContext, request: McpToolRequest): Promise<unknown> {
  assertHermesAuth(request.authToken);
  return executeMcpTool(ctx, request.name, request.input ?? {});
}
