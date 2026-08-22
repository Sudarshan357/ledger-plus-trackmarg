import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { CategoryChart } from '../components/CategoryChart';
import { Empty, SectionLabel, Spinner } from '../components/ui';
import { ChevronLeftIcon, ChevronRightIcon } from '../components/Icons';
import { formatCompact, formatRupees, monthKey, monthLabel, shiftMonth } from '../lib/format';
import type { ReportView } from '../lib/types';

export function ReportsScreen() {
  const [mode, setMode] = useState<'monthly' | 'yearly'>('monthly');
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [report, setReport] = useState<ReportView | null>(null);
  const [loading, setLoading] = useState(true);

  const period = mode === 'monthly' ? month : year;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<ReportView>(`/reports?mode=${mode}&period=${period}`)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Ignoring a response for a period the user has already moved past keeps the figures from
    // flickering back to the previous month when a slow request lands late.
    return () => {
      cancelled = true;
    };
  }, [mode, period]);

  const step = (delta: number) => {
    if (mode === 'monthly') setMonth((current) => shiftMonth(current, delta));
    else setYear((current) => String(Number(current) + delta));
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Reports</h1>
      <div style={{ height: 8 }} />

      <div className="segmented" role="group" aria-label="Report period">
        <button aria-pressed={mode === 'monthly'} onClick={() => setMode('monthly')}>
          Monthly
        </button>
        <button aria-pressed={mode === 'yearly'} onClick={() => setMode('yearly')}>
          Yearly
        </button>
      </div>

      <div style={{ height: 16 }} />

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => step(-1)} aria-label="Previous period" style={{ padding: 4 }}>
          <ChevronLeftIcon size={24} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 800 }}>
          {mode === 'monthly' ? monthLabel(month) : year}
        </div>
        <button onClick={() => step(1)} aria-label="Next period" style={{ padding: 4 }}>
          <ChevronRightIcon size={24} />
        </button>
      </div>

      {loading && !report ? (
        <Spinner />
      ) : !report ? (
        <Empty title="Could not load this report">Check your connection and try again.</Empty>
      ) : (
        <>
          <div style={{ height: 12 }} />
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Received</div>
              <div className="stat-value amount--in">{formatCompact(report.received)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Expenses</div>
              <div className="stat-value amount--out">{formatCompact(report.expense)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Profit</div>
              <div className="stat-value">{formatCompact(report.profit)}</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>
              Expenses by category
            </div>
            <CategoryChart data={report.byCategory} />
          </div>

          <SectionLabel>Per partner</SectionLabel>
          {report.perPartner.length === 0 ? (
            <Empty title="No partners yet" />
          ) : (
            report.perPartner.map((partner) => (
              <div className="card" key={partner.userId}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{partner.name}</div>
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>R: </span>
                    <strong className="amount--in">{formatRupees(partner.received)}</strong>
                  </span>
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>E: </span>
                    <strong className="amount--out">{formatRupees(partner.expense)}</strong>
                  </span>
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>Net: </span>
                    <strong>{formatRupees(partner.net)}</strong>
                  </span>
                </div>
              </div>
            ))
          )}

          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 18 }}>
            Reports cover the whole calendar period across every session, so past settlements
            are still included.
          </p>
        </>
      )}
    </div>
  );
}
