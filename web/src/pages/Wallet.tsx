import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { message } from '../api/messages';
import type { Transaction } from '../api/types';
import { htg, toCents } from '../money';

const PROVIDERS = [
  { value: 'moncash', label: 'MonCash' },
  { value: 'natcash', label: 'NatCash' },
];

function newKey() {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export default function Wallet() {
  const [balance, setBalance] = useState<number | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState('moncash');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [w, t] = await Promise.all([api.wallet(), api.transactions(50)]);
      setBalance(w.balanceCents);
      setTxns(Array.isArray(t) ? t : (t as { items: Transaction[] }).items ?? []);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit(kind: 'deposits' | 'withdrawals', e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    const cents = toCents(amount);
    if (!(cents >= 100)) {
      setError('Montant minimum : 1 HTG.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ id?: number; redirectUrl?: string; status?: string }>(`/payments/${kind}`, {
        provider,
        amountCents: cents,
        idempotencyKey: newKey(),
      });
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
        return;
      }
      setInfo(kind === 'deposits' ? 'Dépôt créé. Suivez les instructions du fournisseur.' : 'Demande de retrait enregistrée.');
      setAmount('');
      await refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Portefeuille</h1>
      <div className="wallet-balance card">
        <span className="muted">Solde</span>
        <strong>{balance === null ? '…' : htg(balance)}</strong>
      </div>

      <div className="wallet-forms">
        <form className="card form" onSubmit={(e) => submit('deposits', e)}>
          <h2>Dépôt</h2>
          <label>
            Montant (HTG)
            <input type="number" min={1} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label>
            Moyen
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Déposer
          </button>
        </form>

        <form className="card form" onSubmit={(e) => submit('withdrawals', e)}>
          <h2>Retrait</h2>
          <label>
            Montant (HTG)
            <input type="number" min={1} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Moyen
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn ghost" type="submit" disabled={busy}>
            Demander un retrait
          </button>
        </form>
      </div>

      {error && <p className="error">{error}</p>}
      {info && <p className="info">{info}</p>}

      <h2 className="section-title">Mouvements récents</h2>
      <div className="card">
        {txns.length === 0 ? (
          <p className="muted center">Aucun mouvement pour le moment.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Montant</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleString('fr-HT')}</td>
                  <td>{t.type}</td>
                  <td className={'num ' + (t.amountCents < 0 ? 'neg' : 'pos')}>{htg(t.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
