import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export async function loadPromptTemplate(name, options = {}) {
    const promptPath = resolvePromptTemplatePath(name, options);
    try {
        return await fs.readFile(promptPath, "utf8");
    }
    catch (error) {
        if (isCustomPromptConfigured(name, options)) {
            const builtinPath = path.join(__dirname, "..", "prompts", `${name}.md`);
            try {
                return await fs.readFile(builtinPath, "utf8");
            }
            catch {
                // Throw the original custom prompt error below for a useful path.
            }
        }
        throw new Error(`Failed to load prompt template "${name}" from ${promptPath}: ${error.message}`, { cause: error });
    }
}
export function compilePrompt(template, variables) {
    let compiled = template;
    for (const [key, value] of Object.entries(variables)) {
        compiled = compiled.replaceAll(`{{${key}}}`, String(value));
    }
    return compiled.trim();
}
export async function loadPromptExamplesForTask(task, paths = [], options = {}) {
    const taskType = inferPromptExampleType(task, paths);
    const examplePath = resolvePromptExamplesPath(taskType, options);
    try {
        return await fs.readFile(examplePath, "utf8");
    }
    catch {
        if (options.rules?.prompts?.examples_directory) {
            try {
                return await fs.readFile(path.join(__dirname, "..", "prompts", "examples", `${taskType}.md`), "utf8");
            }
            catch {
                return "";
            }
        }
        return "";
    }
}
export function inferPromptExampleType(task, paths = []) {
    const haystack = `${task} ${paths.join(" ")}`.toLowerCase();
    if (/\b(review|audit|inspect|code review|pr)\b/.test(haystack)) {
        return "review";
    }
    if (/\b(refactor|rename|restructure|simplify|cleanup|clean up|extract)\b/.test(haystack)) {
        return "refactor";
    }
    if (/\b(add|create|new feature|implement|build|support)\b/.test(haystack)) {
        return "new-feature";
    }
    return "bug-fix";
}
function resolvePromptTemplatePath(name, options) {
    const configuredTemplate = options.rules?.prompts?.templates?.[name];
    if (configuredTemplate) {
        return resolveSafePromptPath(configuredTemplate, options);
    }
    const configuredDirectory = options.rules?.prompts?.directory;
    if (configuredDirectory) {
        return resolveSafePromptPath(path.join(configuredDirectory, `${name}.md`), options);
    }
    return path.join(__dirname, "..", "prompts", `${name}.md`);
}
function resolvePromptExamplesPath(taskType, options) {
    const configuredDirectory = options.rules?.prompts?.examples_directory;
    if (configuredDirectory) {
        return resolveSafePromptPath(path.join(configuredDirectory, `${taskType}.md`), options);
    }
    return path.join(__dirname, "..", "prompts", "examples", `${taskType}.md`);
}
function isCustomPromptConfigured(name, options) {
    return Boolean(options.rules?.prompts?.templates?.[name] || options.rules?.prompts?.directory);
}
function resolveSafePromptPath(value, options) {
    const repoRoot = path.resolve(options.repoRoot || process.cwd());
    const allowedRoots = [...new Set([repoRoot, ...(options.rules?.prompts?.allowed_roots ?? [])].map((entry) => path.resolve(entry)))];
    const baseDir = path.resolve(options.rules?.prompts?.base_dir || repoRoot);
    const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(baseDir, value);
    if (!allowedRoots.some((root) => isPathWithinRoot(root, resolved))) {
        throw new Error(`Unsafe prompt path rejected: ${value}`);
    }
    return resolved;
}
function isPathWithinRoot(root, candidate) {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = path.resolve(candidate);
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}
