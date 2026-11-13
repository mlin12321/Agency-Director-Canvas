import React from "react";
import { GitChangeStatus } from "#/api/open-hands.types";
import { useUnifiedGitDiff } from "#/hooks/query/use-unified-git-diff";
import { FileDiffView } from "./file-diff-view";

export { MAX_DIFF_EDITOR_HEIGHT_PX } from "./file-diff-view";

export interface FileDiffViewerProps {
  path: string;
  type: GitChangeStatus;
  /**
   * When set, show the file's diff as changed by this commit instead of
   * the working-tree-vs-base diff. Deleted files render their content in
   * commit mode (both sides come from git objects).
   */
  commit?: string;
  /**
   * Controlled accordion open state. When omitted, the row manages its own
   * expand/collapse (used by unit tests and standalone embeds).
   */
  isExpanded?: boolean;
  /** Required with `isExpanded` for controlled accordion lists. */
  onToggle?: () => void;
}

/** A file of a conversation's workspace, with its diff read from git there. */
export function FileDiffViewer({
  path,
  type,
  commit,
  isExpanded: controlledExpanded,
  onToggle,
}: FileDiffViewerProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = React.useState(false);
  const isControlled = controlledExpanded !== undefined;
  const isExpanded = isControlled ? controlledExpanded : uncontrolledExpanded;
  const handleToggle = () => {
    if (isControlled) {
      onToggle?.();
      return;
    }
    setUncontrolledExpanded((prev) => !prev);
  };

  const filePath = React.useMemo(() => {
    if (type === "R") {
      const parts = path.split(/\s+/).slice(1);
      return parts[parts.length - 1];
    }
    return path;
  }, [path, type]);

  const {
    data: diff,
    isLoading,
    isSuccess,
    isRefetching,
  } = useUnifiedGitDiff({
    filePath,
    type,
    enabled: isExpanded,
    commit,
  });

  return (
    <FileDiffView
      filePath={filePath}
      type={type}
      diff={diff}
      isFetching={isLoading || isRefetching}
      isReady={isSuccess}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      showDeletedMessage={type === "D" && !commit}
    />
  );
}
