import type { DrinkxHost, LabEvent } from "@service-monitor/core";
import { ModulesLabCharts } from "../ModulesLabCharts";
import type { LabChartSyncPayload } from "../LabChartPanel";

export function ModulesLabChartsSection(props: {
  open: boolean;
  chartCommonProps: {
    events: LabEvent[];
    availableSensors: string[];
    valveIdsByModule: Record<DrinkxHost, string[]>;
    heaterIds: string[];
    liveActuators?: LabChartSyncPayload["liveActuators"];
  };
  chartSensorNames: string[];
}) {
  if (!props.open) return null;
  return (
    <div className="panel">
      <h2>Графики комплекса</h2>
      <ModulesLabCharts
        {...props.chartCommonProps}
        sensorNames={props.chartSensorNames}
        groupByModule
      />
    </div>
  );
}
