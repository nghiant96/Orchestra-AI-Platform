import test from "node:test";
import assert from "node:assert/strict";
import { extractBalancedJson, maskSecrets, parseJsonResponse } from "../ai-system/utils/string.js";

test("extractBalancedJson pulls JSON out of fenced content", () => {
  const input = '```json\n{"name":"demo","items":[1,2,3]}\n```';
  assert.equal(extractBalancedJson(input), '{"name":"demo","items":[1,2,3]}');
});

test("parseJsonResponse extracts the first balanced JSON object from mixed output", () => {
  const input = 'Model preface {"ok":true,"value":42} trailing text';
  assert.deepEqual(parseJsonResponse(input), { ok: true, value: 42 });
});

test("maskSecrets redacts known API token formats", () => {
  const input = "token=sk-abcdefghijklmnopqrstuvwxyz api=AIzaABCDEFGHIJKLMNO auth=ya29.secret-value";
  assert.equal(maskSecrets(input), "token=sk-*** api=AIza*** auth=ya29.***");
});
