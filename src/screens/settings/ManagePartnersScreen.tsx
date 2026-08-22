import { useApp } from '../../state/AppContext';
import { Avatar, PageHead, SectionLabel, Spinner } from '../../components/ui';
import { formatDateShort } from '../../lib/format';

export function ManagePartnersScreen() {
  const { me } = useApp();
  if (!me) return <Spinner />;

  return (
    <>
      <PageHead title="Manage Partners" />
      <div className="screen screen--nonav" style={{ paddingTop: 16 }}>
        <div className="card">
          <div className="mini-label">Trackmarg group code</div>
          <div className="group-code" style={{ margin: '8px 0 6px' }}>
            {me.group.displayCode}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', margin: 0 }}>
            {me.partners.length < 2
              ? 'Share this code with your partner so they can join this ledger.'
              : 'Both partners are connected to this ledger.'}
          </p>
        </div>

        <SectionLabel>Partners ({me.partners.length} of 2)</SectionLabel>

        {me.partners.map((partner) => {
          const isYou = partner.userId === me.user.id;
          return (
            <div className="card" key={partner.userId}>
              <div className="partner-head">
                <Avatar initials={partner.initials} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="partner-name">
                    {partner.name}
                    {isYou && (
                      <span className="badge" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                        You
                      </span>
                    )}
                  </div>
                  <div className="partner-net">{partner.phone}</div>
                </div>
              </div>

              <div className="mini-grid">
                <div className="mini">
                  <div className="mini-label">Status</div>
                  <div className="mini-value amount--in" style={{ fontSize: 15 }}>
                    Connected
                  </div>
                </div>
                <div className="mini">
                  <div className="mini-label">Role</div>
                  <div className="mini-value" style={{ fontSize: 15, textTransform: 'capitalize' }}>
                    {partner.role}
                  </div>
                </div>
                <div className="mini mini--wide">
                  <span className="mini-label">Joined</span>
                  <span style={{ fontWeight: 700 }}>{formatDateShort(partner.joinedAt)}</span>
                </div>
              </div>
            </div>
          );
        })}

        {me.partners.length < 2 && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Waiting for your partner</div>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: 0 }}>
              They should install Ledger+, choose <strong>Join with a group code</strong>, and
              enter <strong>{me.group.displayCode}</strong>.
            </p>
          </div>
        )}

        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Permissions</div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              color: 'var(--text-muted)',
              fontSize: 15,
              display: 'grid',
              gap: 5,
            }}
          >
            <li>Both partners can see every entry, report and settlement.</li>
            <li>Each partner records, edits and deletes only their own entries.</li>
            <li>A deleted record can only be removed permanently by the other partner.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
