import type { LabScenario } from "@service-monitor/core";

export function scenarioHint(s: LabScenario): string {
  switch (s.id) {
    case "status-module":
      return "Чтение coffeemachine.status — безопасно. Ответ в логе Lab.";
    case "milkrinse-micro":
      return "ERP Micro-rinse ~2.5 мин. Ток pump_R_IS (V) с DX UI milk — при reverse не отрицательный. Stop CM не блокируется.";
    case "milkrinse-long":
      return "tubesLength=1500 ≈ 4 мин. Ток (V) на milk; reverse = тот же канал, без знака. Stop CM доступен.";
    case "stop-cm":
      return "Оборвать brew/мойку/rinse. Доступна во время сценария — не ждёт конца rinse.";
    default:
      return s.subject;
  }
}
