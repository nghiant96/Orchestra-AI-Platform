<claude-mem-context>
# Memory Context

# [AI-CODING-SYSTEM] recent context, 2026-05-02 10:51pm GMT+7

No previous sessions found.
</claude-mem-context>

# Agent Operating Notes

These notes define the expected working style for agents operating in this repository.

## 1. Plan Mode Default

- Enter plan mode for any non-trivial task, especially when the task has 3 or more steps or requires architectural decisions.
- If something goes sideways, stop and re-plan instead of continuing blindly.
- Use plan mode for verification work as well, not only for implementation.
- Write detailed specs up front when ambiguity is high.

## 2. Subagent Strategy

- Use subagents to keep the main context window focused and small when the environment supports it.
- Offload research, exploration, and parallel analysis to subagents when it materially improves execution.
- For complex problems, prefer focused subagent tasks over one overloaded thread.
- Keep one clear responsibility per subagent.

## 3. Self-Improvement Loop

- After any correction from the user, capture the lesson in `tasks/lessons.md` for the active project/workspace, not automatically in AI-CODING-SYSTEM unless this repo is the project being changed.
- Turn recurring mistakes into explicit rules that prevent the same failure mode.
- Iterate on these lessons until the same class of mistake stops recurring.
- Review relevant lessons before starting work in this project.

## 4. Verification Before Done

- Do not mark work complete without proving it works.
- Compare changed behavior against the main path or prior behavior when relevant.
- Ask whether a staff-level engineer would approve the result.
- Run tests, inspect logs, and demonstrate correctness when possible.

## 5. Demand Elegance

- For non-trivial changes, pause and ask whether there is a simpler or more elegant approach.
- If a fix feels hacky, prefer the cleaner implementation when the cost is reasonable.
- Do not over-engineer trivial fixes.
- Challenge your own work before presenting it.

## 6. Autonomous Bug Fixing

- When the task is a concrete bug report, default to fixing it rather than asking for step-by-step guidance.
- Use logs, errors, and failing tests as the first source of truth.
- Minimize unnecessary context switching for the user.
- If CI or automated checks fail, investigate and resolve them directly when possible.

## Task Management

1. Write the current plan to `tasks/todo.md` in the active project/workspace root using checkable items for non-trivial work.
2. Confirm the plan before deep implementation work when the task is ambiguous, risky, or large.
3. Mark progress in that workspace's `tasks/todo.md` as work advances.
4. Summarize important changes at a high level as milestones complete.
5. Add a short review/result section to that workspace's `tasks/todo.md` when the task finishes.
6. Update `tasks/lessons.md` in the active project/workspace after meaningful corrections or newly learned project rules.

## Core Principles

- Simplicity first. Touch the smallest safe surface area.
- No lazy fixes. Prefer root-cause corrections over temporary patches.
- Keep changes production-minded: safe, testable, and maintainable.
