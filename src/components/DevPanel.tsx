import { useState } from 'react';

interface DayEntry {
  dayOffset: number;
  date: string;
  words: string[];
}

interface Props {
  token: string;
}

export default function DevPanel({ token }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<DayEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch20 = async (newOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, offset: newOffset }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setResults(data.results);
      setOffset(newOffset);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button className="dev-panel-toggle" onClick={() => { setIsOpen(true); fetch20(0); }}>
        🛠 Dev
      </button>
    );
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-header">
        <strong>Dev: Upcoming Words</strong>
        <button className="dev-panel-close" onClick={() => setIsOpen(false)}>✕</button>
      </div>

      {error && <div className="dev-panel-error">{error}</div>}

      {loading ? (
        <div className="dev-panel-loading">Loading…</div>
      ) : (
        <table className="dev-panel-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Word 1</th>
              <th>Word 2</th>
              <th>Word 3</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ dayOffset, date, words }) => (
              <tr key={dayOffset} className={dayOffset === 0 ? 'dev-panel-today' : ''}>
                <td>{date}{dayOffset === 0 ? ' (today)' : dayOffset < 0 ? ` (${Math.abs(dayOffset)}d ago)` : ` (+${dayOffset}d)`}</td>
                {words.map((w, i) => <td key={i}><code>{w}</code></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="dev-panel-nav">
        <button onClick={() => fetch20(offset - 20)} disabled={loading}>← Prev 20</button>
        <span>Days {offset} – {offset + 19}</span>
        <button onClick={() => fetch20(offset + 20)} disabled={loading}>Next 20 →</button>
      </div>
    </div>
  );
}
