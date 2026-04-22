# Task Todo

Use this file for non-trivial work that benefits from an explicit execution plan.

## Active Task

Task: Make task management workspace-scoped so todo/lessons live in the project being worked on, not automatically in AI-CODING-SYSTEM.

- [x] Define the current task
- [x] Read project guidance and existing lessons
- [x] Find every reference to `tasks/todo.md` and `tasks/lessons.md`
- [x] Update AGENTS.md to make task files workspace-scoped
- [x] Record the workflow lesson in `tasks/lessons.md`
- [x] Review the final diff and record the result

## Review

- Result: Completed.
- Verification:
  - Confirmed only `AGENTS.md` was repo-scoping task files
  - Reviewed updated task-management wording in `AGENTS.md`
- Notes: The rule now says `tasks/todo.md` and `tasks/lessons.md` belong to the active project/workspace root. AI-CODING-SYSTEM keeps its own copies only when this repo itself is the active workspace.
