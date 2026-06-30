import { join } from "node:path";

import { resolveWorkspaceRoot } from "../server/workspace-root.js";

export const resolveDefaultKnowledgeBasePath = (startupCwd: string = process.cwd()): string | undefined => {
  const workspaceRoot = resolveWorkspaceRoot(startupCwd);

  return workspaceRoot === null ? undefined : join(workspaceRoot, "docs", "engine-knowledge-base.md");
};
