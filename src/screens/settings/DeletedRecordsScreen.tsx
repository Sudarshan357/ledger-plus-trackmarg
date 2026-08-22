import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useApp } from '../../state/AppContext';
import { ConfirmSheet, Empty, ErrorText, PageHead, Spinner } from '../../components/ui';
import { ArrowDownIcon, ArrowUpIcon } from '../../components/Icons';
import { formatDate, formatDateTime, formatSigned } from '../../lib/format';
import type { DeletedRecord } from '../../lib/types';

/// The two-person safety rule made visible. A record you deleted is shown to you read-only,
/// with a note saying it is waiting for your partner; the same record shows your partner a
/// Permanently Delete button. The server decides which of the two you get - the
/// `canPermanentlyDelete` flag comes from it, not from a comparison made here.
export function DeletedRecordsScreen() {
  const { refresh } = useApp();
  const [records, setRecords] = useState<DeletedRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<DeletedRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ records: DeletedRecord[] }>('/deleted');
      setRecords(data.records);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load deleted records.');
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const permanentlyDelete = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/deleted/${pending.id}`, { method: 'DELETE' });
      setPending(null);
      await load();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the record.');
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Deleted Records" />
      <div className="screen screen--nonav" style={{ paddingTop: 16 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, marginTop: 0 }}>
          Deleted entries are kept here in full. A record can only be removed permanently by the
          partner who did <em>not</em> delete it.
        </p>

        <ErrorText>{error}</ErrorText>

        {records === null ? (
          <Spinner />
        ) : records.length === 0 ? (
          <Empty title="Nothing deleted">
            Entries you remove from the ledger will appear here.
          </Empty>
        ) : (
          records.map((record) => {
            const isIn = record.type === 'received';
            return (
              <div className="card" key={record.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <span className={`txn-badge ${isIn ? 'txn-badge--in' : 'txn-badge--out'}`}>
                    {isIn ? <ArrowDownIcon size={19} /> : <ArrowUpIcon size={19} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="txn-title">{record.category}</div>
                    <div className="txn-meta">
                      {record.ownerName} · {formatDate(record.date)}
                    </div>
                  </div>
                  <span className={`txn-amount ${isIn ? 'amount--in' : 'amount--out'}`}>
                    {formatSigned(record.amount, record.type)}
                  </span>
                </div>

                {record.notes && <div className="txn-notes">{record.notes}</div>}

                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid var(--border)',
                    fontSize: 14,
                    color: 'var(--text-muted)',
                    display: 'grid',
                    gap: 3,
                  }}
                >
                  <div>
                    Deleted by <strong style={{ color: 'var(--text)' }}>{record.deletedByName}</strong>
                  </div>
                  <div>{record.deletedAt && formatDateTime(record.deletedAt)}</div>
                  <div>{record.sessionLabel}</div>
                </div>

                <div style={{ marginTop: 12 }}>
                  {record.canPermanentlyDelete ? (
                    <button className="btn btn--red btn--sm" onClick={() => setPending(record)}>
                      Permanently Delete
                    </button>
                  ) : (
                    <span className="badge badge--warn">{record.status}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {pending && (
        <ConfirmSheet
          title="Permanently delete this record?"
          body="This record will be permanently removed and cannot be recovered."
          confirmLabel="Delete Permanently"
          busy={busy}
          onConfirm={permanentlyDelete}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
