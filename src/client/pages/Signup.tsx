import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PASSWORD_HINT, USERNAME_HINT, passwordProblem, usernameProblem } from '../../shared/validation';
import { api, ApiError } from '../api';
import { PasswordInput } from '../components/PasswordInput';
import { useStore } from '../store';

export function Signup() {
  const { boot, pendingGuess, setPendingGuess, refreshBoot } = useStore();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ username: false, password: false });
  const [serverError, setServerError] = useState<{ field: string | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Live validation once a field has been touched; server replies override it.
  const uLocal = usernameProblem(username.trim());
  const pLocal = passwordProblem(password);
  const uError = serverError?.field === 'username' ? serverError.message : touched.username ? uLocal : null;
  const pError = serverError?.field === 'password' ? serverError.message : touched.password ? pLocal : null;
  const generalError = serverError && !serverError.field ? serverError.message : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ username: true, password: true });
    setServerError(null);
    if (uLocal || pLocal) return;
    setBusy(true);
    try {
      const r = await api.signup(username.trim(), password, pendingGuess);
      await refreshBoot();
      if (r.guess !== null) {
        setPendingGuess(null);
        navigate('/live', { replace: true });
      } else {
        if (r.guessError) setPendingGuess(null);
        navigate('/', { replace: true, state: { note: r.guessError } });
      }
    } catch (err) {
      if (err instanceof ApiError) setServerError({ field: err.field, message: err.message });
      else setServerError({ field: null, message: 'Something went wrong.' });
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

      <form className="card stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="su-user">Username</label>
          <input
            id="su-user"
            className={`input${uError ? ' invalid' : ''}`}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (serverError?.field === 'username') setServerError(null);
            }}
            onBlur={() => setTouched((t) => ({ ...t, username: true }))}
            aria-invalid={Boolean(uError)}
            aria-describedby="su-user-help"
            autoFocus
          />
          <span id="su-user-help" className={uError ? 'field-error' : 'small'}>
            {uError ?? USERNAME_HINT}
          </span>
          <span className="small">Your username will be shown on the public leaderboard.</span>
        </div>
        <div className="field">
          <label htmlFor="su-pass">Password</label>
          <div onBlur={() => setTouched((t) => ({ ...t, password: true }))}>
            <PasswordInput
              id="su-pass"
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (serverError?.field === 'password') setServerError(null);
              }}
              autoComplete="new-password"
              invalid={Boolean(pError)}
            />
          </div>
          <span className={pError ? 'field-error' : 'small'}>{pError ?? PASSWORD_HINT}</span>
        </div>
        {generalError && <div className="error">{generalError}</div>}
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
