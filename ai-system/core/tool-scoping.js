import fs from "node:fs/promises";
import path from "node:path";
const DEFAULT_TOOL_TIMEOUT_MS = {
    lint: 120000,
    typecheck: 120000,
    build: 180000,
    test: 180000
};
const DEFAULT_TOOL_RETRIES = { lint: 0, typecheck: 0, build: 0, test: 0 };
const DEFAULT_TOOL_BASE_DELAY_MS = 500;
export async function resolveToolCommand(options) {
    const packageScope = options.toolName === "lint" || options.toolName === "test" || options.toolName === "typecheck" || options.toolName === "build"
        ? await detectPackageScopeContext(options.repoRoot, options.changedPaths, options.packageManager)
        : null;
    const workspaceScope = options.toolName === "lint" || options.toolName === "test" || options.toolName === "typecheck" || options.toolName === "build"
        ? await detectWorkspaceScopeContext(options.repoRoot, options.changedPaths, options.packageManager)
        : null;
    if (options.toolConfig?.enabled === false)
        return null;
    if (options.toolConfig?.command)
        return buildConfiguredCommand(options);
    if (!options.toolConfig?.script) {
        const scopedAutoCommand = resolveAutoScopedToolCommand(options.repoRoot, options.toolName, options.toolConfig, options.packageScripts, options.packageManager, options.changedPaths, packageScope, options.sandbox);
        if (scopedAutoCommand)
            return scopedAutoCommand;
    }
    if (!options.toolConfig?.script && workspaceScope) {
        const workspaceCommand = resolveWorkspaceToolCommand(options.toolName, workspaceScope, options.toolConfig, options.sandbox);
        if (workspaceCommand)
            return workspaceCommand;
    }
    if (options.toolName === "typecheck" && !options.toolConfig?.script && packageScope?.tsconfigPath) {
        const pkg = await resolvePackageTypecheckCommand(options.toolName, options.repoRoot, packageScope, options.toolConfig, options.sandbox);
        if (pkg)
            return pkg;
    }
    if (!options.toolConfig?.script && packageScope) {
        const packageScriptName = resolveToolScriptName(options.toolName, undefined, packageScope.packageScripts);
        if (packageScriptName) {
            return buildScriptCommand(options.toolName, packageScriptName, packageScope.packageManager, options.toolConfig, packageScope.relativeChangedPaths, {
                cwd: packageScope.cwd,
                scope: "package",
                sandbox: options.sandbox,
                workingDirectory: packageScope.workingDirectory
            });
        }
    }
    const scriptName = resolveToolScriptName(options.toolName, options.toolConfig, options.packageScripts);
    if (scriptName) {
        return buildScriptCommand(options.toolName, scriptName, options.packageManager, options.toolConfig, options.changedPaths, {
            cwd: options.repoRoot,
            scope: options.toolConfig?.append_changed_files === true || usesChangedFilePlaceholder(options.toolConfig?.args ?? []) ? "changed-files" : "full",
            sandbox: options.sandbox
        });
    }
    const adapterCommand = resolveAdapterToolCommand(options.toolName, options.adapterContexts, options.toolConfig, options.changedPaths, options.sandbox);
    if (adapterCommand)
        return adapterCommand;
    if (options.changedPaths.length > 0 && allChangedPathsHandledByAdapters(options.changedPaths, options.adapterContexts))
        return null;
    if (options.toolName === "typecheck") {
        if (packageScope?.tsconfigPath) {
            const pkg = await resolvePackageTypecheckCommand(options.toolName, options.repoRoot, packageScope, options.toolConfig, options.sandbox);
            if (pkg)
                return pkg;
        }
        const tsConfigPath = path.join(options.repoRoot, "tsconfig.json");
        try {
            await fs.access(tsConfigPath);
            return {
                name: options.toolName,
                command: "node",
                args: ["./node_modules/typescript/bin/tsc", "--noEmit", "-p", tsConfigPath],
                display: "node ./node_modules/typescript/bin/tsc --noEmit",
                cwd: options.repoRoot,
                timeoutMs: numberOrDefault(options.toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[options.toolName] || 120000),
                retries: numberOrDefault(options.toolConfig?.retries, DEFAULT_TOOL_RETRIES[options.toolName] || 0),
                baseDelayMs: numberOrDefault(options.toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
                source: "fallback",
                scopedToChangedFiles: false,
                scope: "full",
                sandboxMode: options.sandbox.mode,
                image: options.sandbox.image,
                env: options.sandbox.env
            };
        }
        catch {
            return null;
        }
    }
    return null;
}
export function resolveFullScopeFallback(options) {
    const scriptName = resolveToolScriptName(options.toolName, options.toolConfig, options.packageScripts);
    if (scriptName) {
        return buildScriptCommand(options.toolName, scriptName, options.packageManager, options.toolConfig, options.changedPaths, {
            cwd: options.repoRoot,
            scope: "full",
            sandbox: options.sandbox
        });
    }
    const adapterCommand = resolveAdapterToolCommand(options.toolName, options.adapterContexts, options.toolConfig, options.changedPaths, options.sandbox);
    if (adapterCommand && adapterCommand.scope !== "full") {
        return { ...adapterCommand, scope: "full", scopedToChangedFiles: false };
    }
    return null;
}
function resolveAdapterToolCommand(toolName, adapterContexts, toolConfig, changedPaths, sandbox) {
    for (const adapter of adapterContexts) {
        const adapterCommandConfig = adapter.commands[toolName];
        if (!adapterCommandConfig || adapterCommandConfig.enabled === false || !adapterCommandConfig.command) {
            continue;
        }
        const adapterChangedPaths = filterChangedPathsForAdapter(changedPaths, adapter);
        const args = expandToolArgs((adapterCommandConfig.args ?? []).map(String), adapterChangedPaths, adapterCommandConfig.append_changed_files === true);
        return {
            name: toolName,
            command: adapterCommandConfig.command,
            args,
            display: [adapterCommandConfig.command, ...args].join(" ").trim(),
            cwd: adapter.cwd,
            timeoutMs: numberOrDefault(adapterCommandConfig.timeout_ms ?? toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
            retries: numberOrDefault(adapterCommandConfig.retries ?? toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
            baseDelayMs: numberOrDefault(adapterCommandConfig.base_delay_ms ?? toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
            source: "adapter",
            scopedToChangedFiles: usesChangedFilePlaceholder(adapterCommandConfig.args ?? []) || adapterCommandConfig.append_changed_files === true,
            scope: adapter.workingDirectory === "." ? "full" : "package",
            sandboxMode: sandbox.mode,
            image: sandbox.image,
            imageProfile: adapter.name,
            env: sandbox.env,
            workingDirectory: adapter.workingDirectory
        };
    }
    return null;
}
function resolveAutoScopedToolCommand(repoRoot, toolName, toolConfig, packageScripts, packageManager, changedPaths, packageScope, sandbox) {
    if (changedPaths.length === 0 || (toolName !== "lint" && toolName !== "test"))
        return null;
    const scopedCandidates = getScopedScriptCandidates(toolName);
    for (const candidate of scopedCandidates) {
        if (packageScope && typeof packageScope.packageScripts[candidate.script] === "string") {
            return buildScriptCommand(toolName, candidate.script, packageScope.packageManager, { append_changed_files: candidate.appendChangedFiles }, packageScope.relativeChangedPaths, {
                cwd: packageScope.cwd,
                scope: candidate.appendChangedFiles ? "changed-files" : "package",
                sandbox,
                workingDirectory: packageScope.workingDirectory
            });
        }
        if (typeof packageScripts[candidate.script] === "string") {
            return buildScriptCommand(toolName, candidate.script, packageManager, { append_changed_files: candidate.appendChangedFiles }, changedPaths, {
                cwd: repoRoot,
                scope: candidate.appendChangedFiles ? "changed-files" : "full",
                sandbox
            });
        }
    }
    return resolveDirectPackageLintCommand(toolName, packageScope, toolConfig, sandbox);
}
function resolveWorkspaceToolCommand(toolName, workspaceScope, toolConfig, sandbox) {
    const scriptName = resolveWorkspaceScriptName(toolName, workspaceScope.packages);
    if (!scriptName)
        return null;
    const filters = workspaceScope.packages.flatMap((pkg) => ["--filter", pkg.name]);
    return {
        name: toolName,
        command: "pnpm",
        args: [...filters, "run", scriptName],
        display: ["pnpm", ...filters, "run", scriptName].join(" "),
        cwd: workspaceScope.repoRoot,
        timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
        retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
        baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
        source: "auto-detected-script",
        scopedToChangedFiles: false,
        scope: "workspace",
        sandboxMode: sandbox.mode,
        image: sandbox.image,
        env: sandbox.env,
        workingDirectory: workspaceScope.packages.map((pkg) => pkg.workingDirectory).join(",")
    };
}
function resolvePackageTypecheckCommand(toolName, repoRoot, packageScope, toolConfig, sandbox) {
    return findTypescriptCompilerPath(packageScope.cwd, repoRoot).then((tscPath) => {
        if (!tscPath || !packageScope.tsconfigPath)
            return null;
        return {
            name: toolName,
            command: "node",
            args: [tscPath, "--noEmit", "-p", packageScope.tsconfigPath],
            display: `node ${tscPath} --noEmit -p ${packageScope.tsconfigPath}`,
            cwd: packageScope.cwd,
            timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
            retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
            baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
            source: "fallback",
            scopedToChangedFiles: false,
            scope: "package",
            sandboxMode: sandbox.mode,
            image: sandbox.image,
            env: sandbox.env,
            workingDirectory: packageScope.workingDirectory
        };
    });
}
function resolveWorkspaceScriptName(toolName, packages) {
    if (packages.length === 0)
        return null;
    const scriptNames = packages.map((pkg) => resolveToolScriptName(toolName, undefined, pkg.packageScripts));
    const [first] = scriptNames;
    return first && scriptNames.every((scriptName) => scriptName === first) ? first : null;
}
function resolveToolScriptName(toolName, toolConfig, packageScripts) {
    if (typeof toolConfig?.script === "string" && toolConfig.script.trim())
        return toolConfig.script.trim();
    const scriptCandidates = toolName === "typecheck" ? ["type-check", "typecheck"] : [toolName];
    for (const candidate of scriptCandidates)
        if (typeof packageScripts[candidate] === "string")
            return candidate;
    return null;
}
function buildScriptCommand(toolName, scriptName, packageManager, toolConfig, changedPaths, options) {
    const extraArgs = expandToolArgs((toolConfig?.args ?? []).map(String), changedPaths, toolConfig?.append_changed_files === true);
    const scopedToChangedFiles = usesChangedFilePlaceholder(toolConfig?.args ?? []) || toolConfig?.append_changed_files === true;
    const source = typeof toolConfig?.script === "string" && toolConfig.script.trim() ? "configured-script" : "auto-detected-script";
    const cwd = options?.cwd ?? process.cwd();
    const scope = options?.scope ?? (scopedToChangedFiles ? "changed-files" : "full");
    const command = packageManager === "yarn" ? "yarn" : packageManager === "npm" ? "npm" : "pnpm";
    const args = command === "yarn" ? [scriptName, ...extraArgs] : ["run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])];
    return { name: toolName, command, args, display: [command, ...args].join(" "), cwd, timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000), retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0), baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS), source, scopedToChangedFiles, scope, sandboxMode: options?.sandbox.mode ?? "inherit", image: options?.sandbox.image, env: options?.sandbox.env ?? { ...process.env }, workingDirectory: options?.workingDirectory };
}
function getScopedScriptCandidates(toolName) {
    if (toolName === "lint")
        return [{ script: "lint:changed", appendChangedFiles: true }, { script: "lint:files", appendChangedFiles: true }, { script: "lint:staged", appendChangedFiles: true }];
    if (toolName === "test")
        return [{ script: "test:changed", appendChangedFiles: true }, { script: "test:related", appendChangedFiles: true }, { script: "test:staged", appendChangedFiles: true }, { script: "test:affected", appendChangedFiles: false }, { script: "affected:test", appendChangedFiles: false }];
    return [];
}
function resolveDirectPackageLintCommand(toolName, packageScope, toolConfig, sandbox) {
    if (toolName !== "lint" || !packageScope || packageScope.relativeChangedPaths.length === 0)
        return null;
    const lintScript = packageScope.packageScripts.lint;
    if (!lintScript || !isGenericEslintScript(lintScript))
        return null;
    const lintablePaths = packageScope.relativeChangedPaths.filter(isEslintablePath);
    if (lintablePaths.length === 0)
        return null;
    const args = buildPackageManagerExecArgs(packageScope.packageManager, "eslint", lintablePaths);
    return {
        name: toolName,
        command: packageScope.packageManager,
        args,
        display: [packageScope.packageManager, ...args].join(" "),
        cwd: packageScope.cwd,
        timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
        retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
        baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
        source: "fallback",
        scopedToChangedFiles: true,
        scope: "changed-files",
        sandboxMode: sandbox.mode,
        image: sandbox.image,
        env: sandbox.env,
        workingDirectory: packageScope.workingDirectory
    };
}
function filterChangedPathsForAdapter(changedPaths, adapter) {
    if (adapter.changedFileExtensions.length === 0)
        return changedPaths;
    return changedPaths.filter((changedPath) => adapter.changedFileExtensions.includes(path.extname(changedPath).toLowerCase()));
}
function allChangedPathsHandledByAdapters(changedPaths, adapterContexts) {
    if (adapterContexts.length === 0)
        return false;
    return changedPaths.every((changedPath) => adapterContexts.some((adapter) => adapter.changedFileExtensions.length === 0 || adapter.changedFileExtensions.includes(path.extname(changedPath).toLowerCase())));
}
function buildPackageManagerExecArgs(packageManager, binary, args) {
    if (packageManager === "npm")
        return ["exec", binary, "--", ...args];
    if (packageManager === "yarn")
        return [binary, ...args];
    return ["exec", binary, ...args];
}
function isGenericEslintScript(script) {
    return /^eslint\s+\.?(?:\s|$)/.test(script.trim());
}
function isEslintablePath(filePath) {
    return [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].includes(path.extname(filePath).toLowerCase());
}
async function findTypescriptCompilerPath(packageDir, repoRoot) {
    const candidates = [path.join(packageDir, "node_modules", "typescript", "bin", "tsc"), path.join(repoRoot, "node_modules", "typescript", "bin", "tsc")];
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        }
        catch {
            // continue walking
        }
    }
    return null;
}
function normalizePath(value) {
    return value.replace(/\\/g, "/");
}
function buildConfiguredCommand(options) {
    const args = expandToolArgs((options.toolConfig?.args ?? []).map(String), options.changedPaths, options.toolConfig?.append_changed_files === true);
    return {
        name: options.toolName,
        command: options.toolConfig.command,
        args,
        display: [options.toolConfig.command, ...args].join(" ").trim(),
        cwd: options.repoRoot,
        timeoutMs: numberOrDefault(options.toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[options.toolName] || 120000),
        retries: numberOrDefault(options.toolConfig?.retries, DEFAULT_TOOL_RETRIES[options.toolName] || 0),
        baseDelayMs: numberOrDefault(options.toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
        source: "configured-command",
        scopedToChangedFiles: usesChangedFilePlaceholder(options.toolConfig?.args ?? []) || options.toolConfig?.append_changed_files === true,
        scope: usesChangedFilePlaceholder(options.toolConfig?.args ?? []) || options.toolConfig?.append_changed_files === true ? "changed-files" : "full",
        sandboxMode: options.sandbox.mode,
        image: options.sandbox.image,
        imageProfile: options.projectType,
        env: options.sandbox.env
    };
}
async function readPackageJson(packageJsonPath) {
    try {
        const raw = await fs.readFile(packageJsonPath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function normalizeScripts(packageJson) {
    const scripts = packageJson?.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts))
        return {};
    return Object.fromEntries(Object.entries(scripts)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, String(value)]));
}
async function findNearestPackageDir(repoRoot, changedPath) {
    let currentDir = path.dirname(path.join(repoRoot, changedPath));
    const resolvedRepoRoot = path.resolve(repoRoot);
    while (currentDir.startsWith(resolvedRepoRoot)) {
        try {
            await fs.access(path.join(currentDir, "package.json"));
            return currentDir;
        }
        catch {
            // continue walking
        }
        if (currentDir === resolvedRepoRoot)
            break;
        currentDir = path.dirname(currentDir);
    }
    return null;
}
async function findPackageTsconfigPath(packageDir) {
    const candidates = ["tsconfig.json", "tsconfig.build.json"];
    for (const candidate of candidates) {
        const candidatePath = path.join(packageDir, candidate);
        try {
            await fs.access(candidatePath);
            return candidatePath;
        }
        catch {
            continue;
        }
    }
    return undefined;
}
async function detectPackageScopeContext(repoRoot, changedPaths, packageManager) {
    if (changedPaths.length === 0)
        return null;
    const packageDirs = new Set();
    for (const changedPath of changedPaths) {
        const packageDir = await findNearestPackageDir(repoRoot, changedPath);
        if (!packageDir)
            return null;
        packageDirs.add(packageDir);
    }
    if (packageDirs.size !== 1)
        return null;
    const [packageDir] = [...packageDirs];
    if (!packageDir || path.resolve(packageDir) === path.resolve(repoRoot))
        return null;
    const packageJson = await readPackageJson(path.join(packageDir, "package.json"));
    const packageScripts = normalizeScripts(packageJson);
    const tsconfigPath = await findPackageTsconfigPath(packageDir);
    return {
        cwd: packageDir,
        packageScripts,
        packageManager,
        relativeChangedPaths: changedPaths.map((changedPath) => normalizePath(path.relative(packageDir, path.join(repoRoot, changedPath)))),
        workingDirectory: normalizePath(path.relative(repoRoot, packageDir)) || ".",
        ...(tsconfigPath ? { tsconfigPath } : {})
    };
}
async function detectWorkspaceScopeContext(repoRoot, changedPaths, packageManager) {
    if (packageManager !== "pnpm" || changedPaths.length === 0)
        return null;
    try {
        await fs.access(path.join(repoRoot, "pnpm-workspace.yaml"));
    }
    catch {
        return null;
    }
    const packageDirs = new Set();
    for (const changedPath of changedPaths) {
        const packageDir = await findNearestPackageDir(repoRoot, changedPath);
        if (!packageDir || path.resolve(packageDir) === path.resolve(repoRoot))
            return null;
        packageDirs.add(packageDir);
    }
    if (packageDirs.size <= 1)
        return null;
    const packages = [];
    for (const packageDir of packageDirs) {
        const packageJson = await readPackageJson(path.join(packageDir, "package.json"));
        const packageName = typeof packageJson?.name === "string" ? packageJson.name.trim() : "";
        if (!packageName)
            return null;
        packages.push({ name: packageName, cwd: packageDir, workingDirectory: normalizePath(path.relative(repoRoot, packageDir)) || ".", packageScripts: normalizeScripts(packageJson) });
    }
    return { repoRoot, packageManager: "pnpm", packages };
}
function expandToolArgs(args, changedPaths, appendChangedFiles) {
    const output = [];
    for (const arg of args) {
        if (arg === "{changed_files}") {
            output.push(...changedPaths);
            continue;
        }
        if (arg === "{changed_files_csv}") {
            output.push(changedPaths.join(","));
            continue;
        }
        output.push(arg);
    }
    if (appendChangedFiles)
        output.push(...changedPaths);
    return output;
}
function usesChangedFilePlaceholder(args) {
    return (args ?? []).some((arg) => arg === "{changed_files}" || arg === "{changed_files_csv}");
}
function numberOrDefault(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
