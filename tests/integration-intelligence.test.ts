import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeIntegration } from "../ai-system/core/integration-intelligence.js";

test("integration intelligence writes a warning report for frontend/backend mismatches", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "integration-intel-"));

  try {
    await fs.mkdir(path.join(repoRoot, "dashboard", "src"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "ai-system", "server", "routes"), { recursive: true });

    await fs.writeFile(
      path.join(repoRoot, "dashboard", "src", "app.tsx"),
      [
        "import { apiJson } from '../../src/utils/api';",
        "export async function load() {",
        "  await apiJson('/api/health');",
        "  await fetch(`/api/users/${'abc'}`);",
        "  await axios.post('/api/axios-call');",
        "  await apiClient.get('/api/client-call');",
        "}"
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(repoRoot, "ai-system", "server", "routes", "health.ts"),
      [
        "export function route(req: { method?: string }, url: URL) {",
        "  if (url.pathname === '/api/health' && req.method === 'GET') return true;",
        "  if (url.pathname === '/api/server-only' && req.method === 'POST') return true;",
        "  router.get('/api/router-call', () => true);",
        "@Get('/api/decorator-call')",
        "  return false;",
        "}"
      ].join("\n"),
      "utf8"
    );

    const report = await analyzeIntegration(repoRoot);

    assert.equal(report.version, 1);
    assert.equal(report.frontend.endpointCount >= 4, true);
    assert.equal(report.backend.routeCount >= 4, true);
    assert.equal(report.warnings.length > 0, true);
    assert.ok(report.mismatches.some((entry) => entry.kind === "frontend-without-backend"));
    assert.ok(report.frontend.endpoints.some((entry) => entry.endpoint.includes("/api/axios-call")));
    assert.ok(report.backend.routes.some((entry) => entry.endpoint.includes("/api/router-call")));

    const written = JSON.parse(await fs.readFile(path.join(repoRoot, "integration", "integration-check.json"), "utf8"));
    assert.equal(written.version, 1);
    assert.equal(Array.isArray(written.warnings), true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
