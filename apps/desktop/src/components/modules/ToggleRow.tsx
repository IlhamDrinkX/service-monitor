export function ToggleRow(props: {
  label: string;
  code: string;
  on: boolean | null;
  disabled: boolean;
  onToggle: () => void;
  actionLabel?: string;
}) {
  const active = props.on === true;
  const lampClass =
    props.on === true ? "lamp on" : props.on === false ? "lamp" : "lamp unk";
  return (
    <div className="device-row">
      <span className={lampClass} title={String(props.on)} />
      <div className="device-label">
        <span className="device-code">{props.code}</span>
        <span className="device-text">{props.label}</span>
      </div>
      <button
        type="button"
        className={`btn toggle-btn${active ? " toggle-on" : ""}`}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        {props.actionLabel ?? (active ? "ON" : "OFF")}
      </button>
    </div>
  );
}
