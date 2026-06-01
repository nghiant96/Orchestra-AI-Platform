const DESTRUCTIVE_COMMANDS = new Set([
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -fr /",
    "dd if=",
    "mkfs",
    "mkswap",
    ":(){ :|:& };:",
    "> /dev/sda",
    "chmod -R 777 /",
    "chown -R root /",
    "git push --force origin main",
    "git push --force origin master",
    "git push -f origin main",
    "git push -f origin master",
    "docker rm -f $(docker ps -aq)",
    "kubectl delete",
]);
const DESTRUCTIVE_PATTERNS = [
    /rm\s+-rf\s+\//,
    /sudo\s+rm/,
    /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    /mkfs\.\w+/,
    />\s*\/dev\/(sd|hd|nvme|md|xvd)/,
    /chmod\s+.*\s+\/\s*$/,
    /chown\s+.*\s+\/\s*$/,
    /\.\.\/\s*.*\/\s*\/etc\//,
    /(^|[;\s])shutdown(\s|$)/,
    /(^|[;\s])reboot(\s|$)/,
    /(^|[;\s])halt(\s|$)/,
    /(^|[;\s])poweroff(\s|$)/,
    /(^|[;\s])init\s+[06](\s|$)/,
];
const APPROVAL_REQUIRED_PATTERNS = [
    /git\s+push/,
    /git\s+commit/,
    /npm\s+publish/,
    /pnpm\s+publish/,
    /docker\s+push/,
    /kubectl\s+apply/,
    /terraform\s+apply/,
    /curl\s+.*\|\s*(ba)?sh/,
    /wget\s+.*-O\s*-\s*\|\s*(ba)?sh/,
];
export function checkCommand(command) {
    const trimmed = command.trim().toLowerCase();
    if (DESTRUCTIVE_COMMANDS.has(trimmed)) {
        return { allowed: false, blocked: true, reason: "Destructive command is blocked" };
    }
    for (const pattern of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { allowed: false, blocked: true, reason: `Command matches destructive pattern: ${pattern.source}` };
        }
    }
    for (const pattern of APPROVAL_REQUIRED_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { allowed: true, requiresApproval: true, reason: `Command requires explicit approval: ${pattern.source}` };
        }
    }
    if (trimmed.startsWith("sudo ")) {
        return { allowed: false, blocked: true, reason: "sudo commands are not allowed" };
    }
    return { allowed: true };
}
export function isCommandAllowed(command) {
    return checkCommand(command).allowed;
}
