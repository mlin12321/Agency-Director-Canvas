import { useParams } from "react-router";
import { OrgChartView } from "#/components/features/org-chart/org-chart-view";

export default function OrgChartRoute() {
  const { nodeId } = useParams();
  return <OrgChartView nodeId={nodeId ?? null} />;
}
