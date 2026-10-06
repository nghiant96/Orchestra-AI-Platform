import { capActorRole, roleCan, type AuditActor } from "./audit-log.js";
import type { RulesConfig } from "../types.js";

export function resolveProjectRole(actor: AuditActor, rules: RulesConfig, projectId?: string): AuditActor {
  const projectRole = projectId ? rules.auth?.project_role_mapping?.[projectId]?.[actor.id] : undefined;
  // The mapping is keyed on a client-asserted actor id, so it must not lift the
  // actor above its credential's ceiling.
  return projectRole ? capActorRole({ ...actor, role: projectRole }, actor.maxRole) : actor;
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
  return roleCan(effectiveActor, required);
}
