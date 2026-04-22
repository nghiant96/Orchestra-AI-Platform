import test from "node:test";
import assert from "node:assert/strict";
import { assertMatchesBasicSchema, extractStructuredData } from "../ai-system/utils/schema.js";
import type { JsonSchema } from "../ai-system/types.js";

const BASIC_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    count: { type: "integer" }
  },
  required: ["name", "count"]
};

test("extractStructuredData finds nested JSON payloads breadth-first", () => {
  const payload = {
    meta: "ignored",
    payload: {
      message: '{"name":"demo","count":2}'
    }
  };

  assert.deepEqual(extractStructuredData(payload, BASIC_SCHEMA, "planner output"), {
    name: "demo",
    count: 2
  });
});

test("assertMatchesBasicSchema rejects disallowed extra keys", () => {
  assert.throws(
    () =>
      assertMatchesBasicSchema(
        { name: "demo", count: 2, extra: true },
        BASIC_SCHEMA,
        "planner output"
      ),
    /\$\.extra is not allowed/
  );
});
