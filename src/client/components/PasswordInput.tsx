import { useState } from 'react';

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'new-password' | 'current-password';
  invalid?: boolean;
  autoFocus?: boolean;
}

/** Password field with a show / hide toggle so people can check for typos. */
export function PasswordInput({ id, value, onChange, autoComplete, invalid, autoFocus }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="pw-wrap">
      <input
        id={id}
        className={`input pw-input${invalid ? ' invalid' : ''}`}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        required
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
