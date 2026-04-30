import type { ToolAdapterConfig } from "../types.js";

export function buildBuiltinToolAdapters(
  projectType: string,
  timeoutMs: Record<string, number>
): Array<ToolAdapterConfig & { name: string }> {
  if (projectType === "node") {
    return [];
  }

  const adapters: Array<ToolAdapterConfig & { name: string }> = [
    {
      name: "python",
      detect_files: ["pyproject.toml", "pytest.ini", "requirements.txt"],
      changed_file_extensions: [".py"],
      commands: {
        test: {
          command: "pytest",
          args: [],
          timeout_ms: timeoutMs.test
        }
      }
    },
    {
      name: "go",
      detect_files: ["go.mod"],
      changed_file_extensions: [".go"],
      commands: {
        lint: {
          command: "golangci-lint",
          args: ["run", "./..."],
          timeout_ms: timeoutMs.lint
        },
        typecheck: {
          command: "go",
          args: ["vet", "./..."],
          timeout_ms: timeoutMs.typecheck
        },
        test: {
          command: "go",
          args: ["test", "./..."],
          timeout_ms: timeoutMs.test
        }
      }
    },
    {
      name: "rust",
      detect_files: ["Cargo.toml"],
      changed_file_extensions: [".rs"],
      commands: {
        lint: {
          command: "cargo",
          args: ["clippy", "--", "-D", "warnings"],
          timeout_ms: timeoutMs.lint
        },
        typecheck: {
          command: "cargo",
          args: ["check"],
          timeout_ms: timeoutMs.typecheck
        },
        test: {
          command: "cargo",
          args: ["test"],
          timeout_ms: timeoutMs.test
        }
      }
    }
  ];

  return projectType === "auto" ? adapters : adapters.filter((adapter) => adapter.name === projectType);
}
