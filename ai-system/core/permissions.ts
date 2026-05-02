import type { AuditActor } from "./audit-log.js";
import type { RulesConfig } from "../types.js";

export function resolveProjectRole(actor: AuditActor, rules: RulesConfig, projectId?: string): AuditActor {
  const projectRole = projectId ? rules.auth?.project_role_mapping?.[projectId]?.[actor.id] : undefined;
  return projectRole ? { ...actor, role: projectRole } : actor;
}

export function canPerformAction(
  actor: AuditActor,
  rules: RulesConfig,
  action: string,
  projectId?: string
): boolean {
  const required = rules.auth?.action_permissions?.[action];
  const effectiveActor = resolveProjectRole(actor, rules, projectId);
  if (!required) return true;
  return roleRank(effectiveActor.role) >= roleRank(required);
}

function roleRank(role: AuditActor["role"]): number {
  return role === "admin" ? 2 : role === "operator" ? 1 : 0;
}
