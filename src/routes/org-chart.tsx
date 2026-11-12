import { useParams } from "react-router";
import { OrgNodeWorkspace } from "#/components/features/org-chart/org-node-workspace";

export default function OrgChartRoute() {
  const { nodeId } = useParams();
  return <OrgNodeWorkspace nodeId={nodeId ?? null} />;
}
