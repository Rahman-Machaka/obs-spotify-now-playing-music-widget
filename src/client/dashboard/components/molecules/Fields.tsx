export function Choice({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`choice ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <div className="choice-visual">{children}</div>
      <span>{label}</span>
    </button>
  );
}

export function AnimationChoice({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={active ? "active" : ""}
      onClick={onClick}
    >
      <strong>{label}</strong>
    </button>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>
        <strong>{label}</strong>
        <output>
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ColorField({
  label,
  hint,
  value,
  resetLabel,
  onReset,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  resetLabel?: string;
  onReset?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="color-setting">
      <div>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <div className="color-setting-controls">
        <label className="color-picker" style={{ background: value }}>
          <span className="visually-hidden">{label}</span>
          <input
            aria-label={label}
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <code>{value.toUpperCase()}</code>
        {resetLabel && onReset && (
          <button type="button" className="text-button" onClick={onReset}>
            {resetLabel}
          </button>
        )}
      </div>
    </div>
  );
}
