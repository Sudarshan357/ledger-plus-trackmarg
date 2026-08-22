import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { formatCompact, formatRupees, formatSignedFull } from '../lib/format';
import { Avatar, Empty, SectionLabel, Spinner } from '../components/ui';
import { ApprovalBanner } from '../components/ApprovalBanner';
import { BranchIcon, ChevronRightIcon, PlusIcon, SwapIcon } from '../components/Icons';

export function HomeScreen() {
  const navigate = useNavigate();
  const { me, overview, pendingApproval } = useApp();

  if (!me || !overview) return <Spinner />;

  const { group } = me;
  const settled = overview.amount === 0 || !overview.from || !overview.to;

  return (
    <>
      <header className="hero">
        <div className="hero-top">
          <div>
            <h1 className="hero-name">{group.name}</h1>
            <p className="hero-tag">Partnership Ledger · {group.displayCode}</p>
          </div>
          <button
            className="hero-action"
            onClick={() => navigate('/settle')}
            aria-label="Record settlement"
          >
            <BranchIcon size={20} />
          </button>
        </div>

        <p className="hero-label">Total business profit</p>
        <div className="hero-amount">{formatRupees(overview.totalProfit)}</div>

        <div className="hero-stats">
          <div>
            <div className="hero-stat-label">Received</div>
            <div className="hero-stat-value">{formatCompact(overview.totalReceived)}</div>
          </div>
          <div className="hero-divider" />
          <div>
            <div className="hero-stat-label">Expenses</div>
            <div className="hero-stat-value">{formatCompact(overview.totalExpense)}</div>
          </div>
          <div className="hero-divider" />
          <div>
            <div className="hero-stat-label">Share/Partner</div>
            <div className="hero-stat-value">{formatCompact(overview.sharePerPartner)}</div>
          </div>
        </div>
      </header>

      <div className="screen screen--flush">
        {/* Above the settlement, because agreeing to a change your partner asked for comes
            before reading figures that the change would alter. */}
        {pendingApproval && (
          <>
            <div style={{ height: 16 }} />
            <ApprovalBanner approval={pendingApproval} />
          </>
        )}

        <SectionLabel>Settlement</SectionLabel>

        <button className="settle-card" onClick={() => navigate('/settle')}>
          <span className="settle-icon">
            <SwapIcon size={20} />
          </span>
          <span className="settle-text">
            {settled ? (
              <>
                <span className="settle-who">All square</span>
                <span className="settle-amount">Nothing to settle right now</span>
              </>
            ) : (
              <>
                <span className="settle-who">
                  {overview.from!.name} needs to send {overview.to!.name}
                </span>
                <span className="settle-amount">{formatRupees(overview.amount)}</span>
              </>
            )}
          </span>
          <ChevronRightIcon className="row-chevron" />
        </button>

        <div style={{ height: 12 }} />
        <button className="btn" onClick={() => navigate('/settle')}>
          <BranchIcon size={19} /> Record Settle
        </button>

        <SectionLabel>Partners</SectionLabel>

        {overview.partners.length === 0 ? (
          <Empty title="No partners yet" />
        ) : (
          overview.partners.map((partner) => (
            <div className="card" key={partner.userId}>
              <div className="partner-head">
                <Avatar initials={partner.initials} />
                <div style={{ minWidth: 0 }}>
                  <div className="partner-name">{partner.name}</div>
                  <div className="partner-net">Net: {formatRupees(partner.net)}</div>
                </div>
              </div>

              <div className="mini-grid">
                <div className="mini">
                  <div className="mini-label">Received</div>
                  <div className="mini-value amount--in">{formatCompact(partner.received)}</div>
                </div>
                <div className="mini">
                  <div className="mini-label">Expenses</div>
                  <div className="mini-value amount--out">{formatCompact(partner.expense)}</div>
                </div>
                <div className="mini mini--wide">
                  <span className="mini-label">Share balance</span>
                  <span
                    className={`mini-value ${
                      partner.shareBalance >= 0 ? 'amount--in' : 'amount--out'
                    }`}
                  >
                    {formatSignedFull(partner.shareBalance)}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}

        {me.partners.length < 2 && (
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Invite your partner</div>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: '0 0 12px' }}>
              Share this Trackmarg group code so they can join the same ledger.
            </p>
            <div className="group-code">{group.displayCode}</div>
          </div>
        )}
      </div>

      <button className="fab" onClick={() => navigate('/add')} aria-label="Add transaction">
        <PlusIcon size={27} />
      </button>
    </>
  );
}
