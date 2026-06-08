import fs from "node:fs/promises";
import path from "node:path";
import type { RepoConventionScanResult } from "./repo-convention-scanner.js";

export interface NamingGuardInput {
  changedFiles: string[];
  conventions?: RepoConventionScanResult | null;
}

export interface NamingGuardFinding {
  code:
    | "SUSPICIOUS_SCENARIO_ID_IN_NAME"
    | "MIXED_CASE_WITH_DIGIT"
    | "UNEXPLAINED_ABBREVIATION"
    | "CONVENTION_MISMATCH";
  severity: "error" | "warning" | "info";
  filePath: string;
  message: string;
}

export interface NamingGuardResult {
  ok: boolean;
  mode: "off" | "warn" | "strict";
  findings: NamingGuardFinding[];
}

const ACCEPTED_TOKENS = [
  "OAuth2",
  "V2",
  "V3",
  "H264",
  "H265",
  "2FA",
  "i18n",
  "l10n",
  "SHA256",
  "MD5"
];

export function runNamingGuard(input: NamingGuardInput): NamingGuardResult {
  const mode = normalizeMode(process.env.ORCHESTRA_NAMING_GUARD_MODE);
  if (mode === "off") {
    return { ok: true, mode, findings: [] };
  }

  const findings = input.changedFiles.flatMap((filePath) => inspectFileName(filePath, mode, input.conventions ?? null));
  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    mode,
    findings
  };
}

export async function writeNamingGuardArtifact(
  artifactDir: string,
  result: NamingGuardResult
): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "naming-check.json"),
    `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
    "utf8"
  );
}

function inspectFileName(
  filePath: string,
  mode: NamingGuardResult["mode"],
  conventions: RepoConventionScanResult | null
): NamingGuardFinding[] {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() ?? normalized;
  const stem = basename.replace(/\.[^.]+$/, "");
  const sanitized = stripAcceptedTokens(stem);
  const severity = mode === "strict" ? "error" : "warning";
  const findings: NamingGuardFinding[] = [];

  if (/(?:^|[-_])s\d(?:[-_]|$)/i.test(sanitized) || /^S\d[A-Z]/.test(sanitized)) {
    findings.push({
      code: "SUSPICIOUS_SCENARIO_ID_IN_NAME",
      severity,
      filePath: normalized,
      message: `${basename} looks like it contains a scenario id rather than a durable domain name.`
    });
  }

  if (/[A-Za-z]\d[A-Za-z]/.test(sanitized) || /[A-Z]{2,}\d/.test(sanitized)) {
    findings.push({
      code: "MIXED_CASE_WITH_DIGIT",
      severity,
      filePath: normalized,
      message: `${basename} mixes letters and digits in a way that may be an accidental generated name.`
    });
  }

  if (/[A-Z]{3,}/.test(sanitized) && !/^[A-Z]+$/.test(sanitized)) {
    findings.push({
      code: "UNEXPLAINED_ABBREVIATION",
      severity: "warning",
      filePath: normalized,
      message: `${basename} contains a long uppercase abbreviation; confirm it matches repo terminology.`
    });
  }

  if (conventions && isPotentialTestFile(normalized) && conventions.testPatterns.length > 0 && !matchesKnownTestPattern(normalized)) {
    findings.push({
      code: "CONVENTION_MISMATCH",
      severity: "warning",
      filePath: normalized,
      message: `${basename} looks test-related but does not match common test filename conventions.`
    });
  }

  return dedupeFindings(findings);
}

function stripAcceptedTokens(value: string): string {
  return ACCEPTED_TOKENS.reduce((next, token) => next.replaceAll(token, ""), value);
}

function isPotentialTestFile(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?|specs?)(\/|$)|test|spec/i.test(filePath);
}

function matchesKnownTestPattern(filePath: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(filePath) || /(^|\/)(__tests__|tests?)\/.+\.[cm]?[jt]sx?$/i.test(filePath);
}

function dedupeFindings(findings: NamingGuardFinding[]): NamingGuardFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}:${finding.filePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMode(value: string | undefined): NamingGuardResult["mode"] {
  return value === "off" || value === "strict" || value === "warn" ? value : "warn";
}
