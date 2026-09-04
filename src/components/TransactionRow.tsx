import { formatDate, formatSigned } from '../lib/format';
import type { Transaction } from '../lib/types';
import { ArrowDownIcon, ArrowUpIcon, EditIcon, TrashIcon } from './Icons';

/// One ledger entry. Received is green with an inbound arrow, expense red with an outbound
/// one - the colour and the arrow say the same thing twice on purpose, so the row is still
/// readable to someone who cannot separate the two colours.
export function TransactionRow({
  txn,
  canDelete,
  onDelete,
  canEdit,
  onEdit,
  pendingEdit,
  tag,
}: {
  txn: Transaction;
  canDelete?: boolean;
  onDelete?: () => void;
  /// Shows the pencil button, which opens the edit form. Same reasoning as canDelete: hidden
  /// rather than offered-and-refused, but the server enforces the real rule either way.
  canEdit?: boolean;
  onEdit?: () => void;
  /// This entry has an edit waiting on the other partner - it still shows its original figures.
  pendingEdit?: boolean;
  /// Small marker in the meta line, used when a list mixes sessions and the row would
  /// otherwise look like it belongs to the current one.
  tag?: string;
}) {
  const isIn = txn.type === 'received';
  return (
    // Deliberately not clickable itself - editing only opens from the pencil button below, so a
    // tap anywhere else on the row (scrolling, glancing at a figure) can never open it by accident.
    <article className="txn">
      <span className={`txn-badge ${isIn ? 'txn-badge--in' : 'txn-badge--out'}`}>
        {isIn ? <ArrowDownIcon size={19} /> : <ArrowUpIcon size={19} />}
      </span>

      <div className="txn-body">
        <div className="txn-title">{txn.category}</div>
        <div className="txn-meta">
          {txn.ownerInitials}
          {/* An entry recorded by the other partner always says so. Whose entry it is and who
              put it there are different facts, and on a shared ledger both matter. */}
          {txn.recordedOnBehalf && ` · recorded by ${txn.createdByName}`} ·{' '}
          {formatDate(txn.date)}
          {tag && <span className="txn-tag">{tag}</span>}
          {pendingEdit && <span className="txn-tag txn-tag--pending">Edit pending approval</span>}
        </div>
        {txn.notes && <div className="txn-notes">{txn.notes}</div>}
      </div>

      <div className="txn-side">
        <span className={`txn-amount ${isIn ? 'amount--in' : 'amount--out'}`}>
          {formatSigned(txn.amount, txn.type)}
        </span>
        <div className="txn-row-actions">
          {canEdit && onEdit && (
            <button
              className="icon-button icon-button--edit"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              aria-label={`Edit ${txn.category} entry of ${formatSigned(txn.amount, txn.type)}`}
            >
              <EditIcon size={18} />
            </button>
          )}
          {canDelete && onDelete && (
            <button
              className="icon-button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label={`Delete ${txn.category} entry of ${formatSigned(txn.amount, txn.type)}`}
            >
              <TrashIcon size={19} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
