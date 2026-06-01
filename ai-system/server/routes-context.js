import { canPerformAction } from "../core/permissions.js";
export function createActorRef(actor) {
    return {
        id: actor.id,
        role: actor.role,
        isAuthorized(action, rules, projectId) {
            return canPerformAction(actor, rules, action, projectId);
        }
    };
}
