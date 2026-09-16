import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="page center" style={{ paddingTop: 60 }}>
      <div className="mono" style={{ fontSize: 64, fontWeight: 700, color: 'var(--text-dim)' }}>
        404
      </div>
      <p className="subtitle">There is nothing here.</p>
      <p>
        <Link to="/">Back to Specs</Link>
      </p>
    </div>
  );
}
