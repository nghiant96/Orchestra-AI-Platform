import { test } from "node:test";
import assert from "node:assert/strict";
import { OutputTail, runCommand } from "../ai-system/utils/api.js";

test("OutputTail holds a bounded amount of output however much arrives", () => {
  const tail = new OutputTail(1000);
  for (let index = 0; index < 500; index += 1) {
    tail.append(Buffer.from("y".repeat(999)));
    assert.ok(tail.retainedChars <= 2000, `retained ${tail.retainedChars} chars after chunk ${index}`);
  }
  assert.equal(tail.bytesSeen, 499_500);
  assert.ok(tail.toString().endsWith("y".repeat(1000)));
});

function nodeScript(source: string) {
  return { command: process.execPath, args: ["-e", source], cwd: process.cwd() };
}

test("runCommand keeps only the tail of a flooding stream", async () => {
  const result = await runCommand({
    ...nodeScript("process.stdout.write('x'.repeat(50000)); process.stdout.write('END-OF-RUN');"),
    maxOutputChars: 1000
  });

  assert.match(result.stdout, /^\[output truncated: kept the last 1000 characters of 50010 bytes\]\n/);
  assert.ok(result.stdout.endsWith("END-OF-RUN"));
  assert.ok(result.stdout.length < 1100);
});

test("runCommand caps stderr on a failing command and still reports the failure", async () => {
  await assert.rejects(
    runCommand({
      ...nodeScript("process.stderr.write('e'.repeat(50000)); process.stderr.write('REAL ERROR'); process.exit(3);"),
      maxOutputChars: 1000
    }),
    (error: Error & { code?: number; stderr?: string }) => {
      assert.equal(error.code, 3);
      assert.ok(error.stderr?.endsWith("REAL ERROR"));
      assert.ok((error.stderr?.length ?? 0) < 1100);
      return true;
    }
  );
});

test("runCommand leaves output under the cap untouched, multi-byte text included", async () => {
  // 600 characters but 1800 bytes: the cap is in characters, so nothing is cut.
  const result = await runCommand({ ...nodeScript("process.stdout.write('ệ'.repeat(600));"), maxOutputChars: 1000 });
  assert.equal(result.stdout, "ệ".repeat(600));
});
