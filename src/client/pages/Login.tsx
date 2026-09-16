import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { PasswordInput } from '../components/PasswordInput';
import { useStore } from '../store';

export function Login() {
  const { boot, pendingGuess, setPendingGuess, refreshBoot } = useStore();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return setError({ field: 'username', message: 'Enter your username.' });
    if (!password) return setError({ field: 'password', message: 'Enter your password.' });
    setBusy(true);
    try {
      const r = await api.login(username.trim(), password, pendingGuess);
      const b = await refreshBoot();
      if (r.guess !== null) {
        setPendingGuess(null);
        navigate('/live', { replace: true });
        return;
      }
      if (r.guessError) setPendingGuess(null);
      const activeWithGuess = b && b.session && b.session.state !== 'finished' && b.myGuess !== null;
      if (r.me.isModerator) navigate('/mod', { replace: true });
      else if (activeWithGuess) navigate('/live', { replace: true });
      else navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError({ field: err.field, message: err.message });
      else setError({ field: null, message: 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  const uError = error?.field === 'username' ? error.message : null;
  const pError = error?.field === 'password' ? error.message : null;
  const generalError = error && !error.field ? error.message : null;

  return (
    <div className="page">
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">{boot?.config.className ?? 'Specs'}</div>
        <h1 className="headline">Log in</h1>
        {pendingGuess !== null && (
          <p className="subtitle">
            Your guess: <b className="mono" style={{ color: 'var(--cyan)', fontSize: 20 }}>{pendingGuess}</b> — it will be submitted when
            you log in.
          </p>
        )}
      </div>

      <form className="card stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="li-user">Username</label>
          <input
            id="li-user"
            className={`input${uError ? ' invalid' : ''}`}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            aria-invalid={Boolean(uError)}
            autoFocus
          />
          {uError && <span className="field-error">{uError}</span>}
        </div>
        <div className="field">
          <label htmlFor="li-pass">Password</label>
          <PasswordInput
            id="li-pass"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setError(null);
            }}
            autoComplete="current-password"
            invalid={Boolean(pError)}
          />
          {pError && <span className="field-error">{pError}</span>}
        </div>
        {generalError && <div className="error">{generalError}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Logging in…' : pendingGuess !== null ? 'Log in and submit guess' : 'Log in'}
        </button>
      </form>

      <p className="small center">
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </div>
  );
}
