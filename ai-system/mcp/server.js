import { assertHermesAuth } from "./auth.js";
import { executeMcpTool } from "./tools.js";
export async function handleMcpTool(ctx, request) {
    assertHermesAuth(request.authToken);
    return executeMcpTool(ctx, request.name, request.input ?? {});
}
