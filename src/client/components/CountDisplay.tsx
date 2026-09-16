import { useEffect, useRef, useState } from 'react';

export function CountDisplay({ count, hasCount, label = 'glasses off so far' }: { count: number; hasCount: boolean; label?: string }) {
  const [pulse, setPulse] = useState(false);
  const prev = useRef(count);
  useEffect(() => {
    if (prev.current === count) return;
    prev.current = count;
    setPulse(true);
    const id = window.setTimeout(() => setPulse(false), 450);
    return () => window.clearTimeout(id);
  }, [count]);
  return (
    <div className="count-display">
      <div className="label">{hasCount ? label : 'count starts with the lecture'}</div>
      <div className={`num${pulse ? ' pulse' : ''}${hasCount ? '' : ' neutral'}`} aria-live="polite">
        {hasCount ? count : 0}
      </div>
    </div>
  );
}
