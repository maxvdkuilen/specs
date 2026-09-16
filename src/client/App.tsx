import { NavLink, Route, Routes } from 'react-router-dom';
import { useStore } from './store';
import { Landing } from './pages/Landing';
import { Signup } from './pages/Signup';
import { Login } from './pages/Login';
import { Live } from './pages/Live';
import { Leaderboard } from './pages/Leaderboard';
import { Me } from './pages/Me';
import { Mod } from './pages/Mod';
import { NotFound } from './pages/NotFound';

function Logo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="20" cy="36" r="12" fill="none" stroke="#00F0FF" strokeWidth="5" />
      <circle cx="44" cy="36" r="12" fill="none" stroke="#00F0FF" strokeWidth="5" />
      <path d="M4 30l4 6M60 30l-4 6" stroke="#00F0FF" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function Nav() {
  const { boot } = useStore();
  const me = boot?.me ?? null;
  const showLive = Boolean(boot?.session && boot.myGuess !== null);
  return (
    <nav className="nav">
      <NavLink to="/" className="wordmark">
        <Logo />
        Specs
      </NavLink>
      <div className="nav-links">
        {showLive && <NavLink to="/live">Live</NavLink>}
        <NavLink to="/leaderboard">Board</NavLink>
        {me?.isModerator && <NavLink to="/mod">Mod</NavLink>}
        {me ? <NavLink to="/me">Me</NavLink> : <NavLink to="/login">Log in</NavLink>}
      </div>
    </nav>
  );
}

export function App() {
  return (
    <div className="shell">
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/live" element={<Live />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/me" element={<Me />} />
        <Route path="/mod" element={<Mod />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}
