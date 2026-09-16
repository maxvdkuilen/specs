import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useStore } from '../store';

export function Signup() {
  const { boot, pendingGuess, setPendingGuess, refreshBoot } = useStore();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.signup(username.trim(), password, pendingGuess);
      await refreshBoot();
      if (r.guess !== null) {
        setPendingGuess(null);
        navigate('/live', { replace: true });
      } else {
        // Account exists; the guess could not be placed (e.g. lecture locked meanwhile). Keep it visible on the landing page.
        if (r.guessError) setPendingGuess(null);
        navigate('/', { replace: true, state: { note: r.guessError } });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">{boot?.config.className ?? 'Specs'}</div>
        <h1 className="headline">Create an account to lock in your guess</h1>
        {pendingGuess !== null ? (
          <p className="subtitle">
            Your guess: <b className="mono" style={{ color: 'var(--cyan)', fontSize: 20 }}>{pendingGuess}</b>
          </p>
        ) : (
          <p className="subtitle">Pick a username and password. That is all.</p>
        )}
      </div>

      <form className="card stack" style={{ gap: 16 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="su-user">Username</label>
          <input
            id="su-user"
            className={`input${error && /username/i.test(error) ? ' invalid' : ''}`}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
          <span className="small">Your username will be shown on the public leaderboard.</span>
        </div>
        <div className="field">
          <label htmlFor="su-pass">Password</label>
          <input
            id="su-pass"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <span className="small">At least 8 characters.</span>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : pendingGuess !== null ? 'Create account and submit guess' : 'Create account'}
        </button>
      </form>

      <p className="small center">
        Already have an account? <Link to="/login">Log in instead</Link>
      </p>
    </div>
  );
}
