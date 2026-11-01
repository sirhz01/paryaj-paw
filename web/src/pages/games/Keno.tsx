import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { message } from '../../api/messages';
import { newIdempotencyKey, walletChanged } from '../../bus';
import { htg, toCents } from '../../money';

interface KenoConfig {
  minStakeCents: number;
  maxStakeCents: number;
  maxPicks: number;
  paytable: Record<string, number[]>;
  rtpPercent: Record<string, number>;
}

interface KenoBet {
  picks: number[];
  drawn: number[];
  hits: number;
  stakeCents: number;
  multiplier: number;
  payoutCents: number;
  balanceCents: number;
}

const GRID = Array.from({ length: 80 }, (_, i) => i + 1);
const STAKES = [25, 50, 100, 250, 500];

export default function Keno() {
  const [config, setConfig] = useState<KenoConfig | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [stake, setStake] = useState('50');
  const [result, setResult] = useState<KenoBet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<KenoConfig>('/keno/config')
      .then(setConfig)
      .catch((e) => setError(message(e)));
  }, []);

  const maxPicks = config?.maxPicks ?? 10;
  const drawnSet = useMemo(() => new Set(result?.drawn ?? []), [result]);
  const picksSet = useMemo(() => new Set(picks), [picks]);
  const paytable = config?.paytable[String(picks.length)];

  function toggle(n: number) {
    setResult(null);
    setPicks((cur) => {
      if (cur.includes(n)) return cur.filter((x) => x !== n);
      if (cur.length >= maxPicks) return cur;
      return [...cur, n];
    });
  }

  function quick() {
    setResult(null);
    const count = picks.length || Math.min(6, maxPicks);
    const next = new Set<number>();
    while (next.size < count) next.add(1 + Math.floor(Math.random() * 80));
    setPicks([...next]);
  }

  async function play() {
    if (!picks.length) return setError('Choisissez au moins 1 numéro.');
    const cents = toCents(stake);
    if (!(cents >= (config?.minStakeCents ?? 100))) return setError('Mise trop basse.');
    setError('');
    setBusy(true);
    try {
      const res = await api.post<KenoBet>('/keno/bets', { picks, stakeCents: cents, idempotencyKey: newIdempotencyKey() });
      setResult(res);
      walletChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="game-head">
        <h1>Keno 20/80</h1>
        <Link to="/" className="btn ghost">
          ← Lobby
        </Link>
      </div>
      <p className="muted">Choisissez de 1 à {maxPicks} numéros. 20 boules sont tirées sur 80. Plus vous trouvez de numéros, plus vous gagnez.</p>

      <div className="keno-grid">
        {GRID.map((n) => {
          const picked = picksSet.has(n);
          const drawn = drawnSet.has(n);
          const hit = picked && drawn;
          return (
            <button
              key={n}
              className={'keno-cell' + (picked ? ' picked' : '') + (drawn ? ' drawn' : '') + (hit ? ' hit' : '')}
              onClick={() => toggle(n)}
            >
              {n}
            </button>
          );
        })}
      </div>

      <div className="keno-controls card">
        <div className="row">
          <span className="muted">
            {picks.length}/{maxPicks} numéros
          </span>
          <button className="btn ghost" onClick={quick}>
            🎲 Aléatoire
          </button>
          <button className="btn ghost" onClick={() => { setPicks([]); setResult(null); }}>
            Effacer
          </button>
        </div>
        <div className="row">
          <label className="inline">
            Mise (HTG)
            <input type="number" min={1} step="any" value={stake} onChange={(e) => setStake(e.target.value)} />
          </label>
          <div className="chips">
            {STAKES.map((s) => (
              <button key={s} className={'chip' + (Number(stake) === s ? ' on' : '')} onClick={() => setStake(String(s))}>
                {s}
              </button>
            ))}
          </div>
          <button className="btn big" onClick={play} disabled={busy || !picks.length}>
            {busy ? '…' : 'Jouer'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {result && (
        <div className={'keno-result card ' + (result.payoutCents > 0 ? 'won' : 'lost')}>
          <div className="result-main">
            <span className="muted">Résultat</span>
            <strong>
              {result.hits} trouvé{result.hits > 1 ? 's' : ''} sur {result.picks.length}
            </strong>
            <span className={result.payoutCents > 0 ? 'win' : 'muted'}>
              {result.payoutCents > 0 ? `Gagné ${htg(result.payoutCents)} (×${result.multiplier})` : 'Perdu'}
            </span>
          </div>
          <div className="drawn-row">
            {result.drawn.map((n) => (
              <span key={n} className={'drawn-ball' + (picksSet.has(n) ? ' hit' : '')}>
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {paytable && (
        <div className="card">
          <h2 className="section-title">
            Table de gains — {picks.length} numéro{picks.length > 1 ? 's' : ''}
            {config && <span className="muted"> · RTP {config.rtpPercent[String(picks.length)]?.toFixed(1)} %</span>}
          </h2>
          <div className="pay-row">
            {paytable.map((coef, hits) =>
              coef > 0 ? (
                <span key={hits} className="pay-item">
                  {hits} trouvé{hits > 1 ? 's' : ''} : <b>×{coef}</b>
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  );
}
