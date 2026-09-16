import { useId } from 'react';

interface Props {
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  autoFocus?: boolean;
}

/** Large number input with big +/- buttons and direct typing. Empty is allowed (null). */
export function NumberInput({ value, onChange, min, max, autoFocus }: Props) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const step = (d: number) => onChange(clamp((value ?? (d > 0 ? min - 1 : min + 1)) + d));
  return (
    <div className="numpad">
      <button type="button" className="step" onClick={() => step(-1)} disabled={value !== null && value <= min} aria-label="Decrease">
        −
      </button>
      <input
        id={id}
        className="input value"
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="?"
        min={min}
        max={max}
        step={1}
        value={value === null ? '' : value}
        autoFocus={autoFocus}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(null);
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(clamp(Math.trunc(n)));
        }}
        aria-label="Your guess"
      />
      <button type="button" className="step" onClick={() => step(1)} disabled={value !== null && value >= max} aria-label="Increase">
        +
      </button>
    </div>
  );
}
