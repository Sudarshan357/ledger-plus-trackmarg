import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useApp } from '../state/AppContext';
import { useTheme, type ThemeChoice } from '../lib/theme';
import { BUILD_ID } from '../lib/version';
import { ConfirmSheet, ErrorText, SectionLabel, Spinner } from '../components/ui';
import {
  BranchIcon,
  ChevronRightIcon,
  CloudUploadIcon,
  FileIcon,
  GridIcon,
  HomeIcon,
  KeyIcon,
  LockIcon,
  LogoutIcon,
  PartnersIcon,
  RestoreIcon,
  TrashIcon,
} from '../components/Icons';
import { TRACKMARG_HUB_URL } from '../lib/trackmarg';
import type { ExportBundle } from '../lib/types';


export function SettingsScreen() {
  const navigate = useNavigate();
  const { me, lock, logout, refresh } = useApp();
  const { choice: theme, resolved, setChoice: setTheme } = useTheme();
  const [busy, setBusy] = useState<'pdf' | 'csv' | 'backup' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; entries: number; from: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!me) return <Spinner />;

  const runExport = async (kind: 'pdf' | 'csv') => {
    setBusy(kind);
    setError(null);
    try {
      // Loaded on demand. jsPDF and its dependencies are around half the weight of this app,
      // and exporting is something a partner does occasionally - making every launch pay for
      // it over a mobile connection would be the wrong trade.
      const [{ exportPdf, exportCsv }, bundle] = await Promise.all([
        import('../lib/export'),
        // Always fetched fresh rather than built from whatever the screen has cached - an
        // exported statement has to match the server, not a stale render.
        api<ExportBundle>('/export'),
      ]);
      if (kind === 'pdf') exportPdf(bundle);
      else exportCsv(bundle);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the export.');
    } finally {
      setBusy(null);
    }
  };

  const runBackup = async () => {
    setBusy('backup');
    setError(null);
    setNotice(null);
    try {
      const data = await api<Record<string, unknown>>('/backup');
      const name = String((data.group as { name?: string })?.name ?? 'ledger')
        .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking straight away cancels the download on some mobile browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice('Backup downloaded. Keep it somewhere safe.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the backup.');
    } finally {
      setBusy(null);
    }
  };

  // Read and check the file BEFORE asking anything, so the confirmation can say how many
  // entries are actually in it rather than asking the user to agree to an unknown.
  const inspectFile = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.format !== 'ledger-plus-backup' || !Array.isArray(parsed.transactions)) {
        throw new Error('not a backup');
      }
      setPendingFile({
        file,
        entries: parsed.transactions.length,
        from: parsed.group?.name ?? 'another partnership',
      });
    } catch {
      setError('That file is not a Ledger+ backup.');
    }
  };

  const runRestore = async () => {
    if (!pendingFile) return;
    setRestoring(true);
    setError(null);
    try {
      const parsed = JSON.parse(await pendingFile.file.text());
      const res = await api<{ imported: number; skipped: number; reassigned: number; rejected: number }>(
        '/backup/restore', { method: 'POST', body: parsed },
      );
      await refresh();
      setPendingFile(null);
      setNotice(
        `Restored ${res.imported} ${res.imported === 1 ? 'entry' : 'entries'}` +
          (res.skipped ? `, skipped ${res.skipped} already present` : '') +
          (res.reassigned ? `, ${res.reassigned} reassigned to a current partner` : '') +
          (res.rejected ? `, ${res.rejected} could not be read` : '') + '.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restore that backup.');
      setPendingFile(null);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Settings</h1>
      <div style={{ height: 10 }} />

      <div className="card">
        <div style={{ fontSize: 19, fontWeight: 800 }}>{me.user.name}</div>
        <div style={{ color: 'var(--text-muted)' }}>{me.user.phone}</div>
        <div className="mini-grid">
          <div className="mini">
            <div className="mini-label">Group code</div>
            <div className="mini-value">{me.group.displayCode}</div>
          </div>
          <div className="mini">
            <div className="mini-label">Partners</div>
            <div className="mini-value">{me.partners.length} of 2</div>
          </div>
          <div className="mini mini--wide">
            <span className="mini-label">Current session</span>
            <span style={{ fontWeight: 800 }}>
              #{String(me.session.seq).padStart(3, '0')}
            </span>
          </div>
        </div>
      </div>

      <SectionLabel>TrackMarg</SectionLabel>
      <div className="card-list">
        <Row
          icon={<HomeIcon size={21} />}
          label="Exit to TrackMarg"
          onClick={() => {
            // Opened as a new context, not by replacing this one. The Android build bundles
            // its own UI and draws no browser chrome, so assigning location.href would leave
            // someone parked on a web page inside Ledger+ with no back button and no way out
            // but force-quitting the app. `_blank` hands it to the system browser on native
            // and opens a tab on the web, and Ledger+ stays where it was in both.
            window.open(TRACKMARG_HUB_URL, '_blank', 'noopener,noreferrer');
          }}
        />
      </div>

      <SectionLabel>Account / Partners</SectionLabel>
      <div className="card-list">
        <Row
          icon={<PartnersIcon size={21} />}
          label="Manage Partners"
          onClick={() => navigate('/settings/partners')}
        />
        <Row
          icon={<BranchIcon size={21} />}
          label="Settlement Details"
          onClick={() => navigate('/settings/settlements')}
        />
        <Row
          icon={<TrashIcon size={21} />}
          label="Deleted Records"
          onClick={() => navigate('/settings/deleted')}
        />
      </div>

      <SectionLabel>Appearance</SectionLabel>
      <div className="card">
        <div className="theme-row">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>Theme</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {theme === 'system' ? `Following your device (${resolved})` : `Always ${theme}`}
            </div>
          </div>
        </div>
        <div className="segmented segmented--full" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as ThemeChoice[]).map((option) => (
            <button
              key={option}
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
              style={{ textTransform: 'capitalize' }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <SectionLabel>Export</SectionLabel>
      <ErrorText>{error}</ErrorText>
      <div className="card-list">
        <Row
          icon={<FileIcon size={21} />}
          label="Export as PDF"
          value={busy === 'pdf' ? 'Preparing…' : undefined}
          onClick={() => void runExport('pdf')}
        />
        <Row
          icon={<GridIcon size={21} />}
          label="Export as CSV"
          value={busy === 'csv' ? 'Preparing…' : undefined}
          onClick={() => void runExport('csv')}
        />
      </div>

      <SectionLabel>Data</SectionLabel>
      {notice && (
        <p style={{ color: 'var(--green)', fontSize: 14, fontWeight: 600, margin: '0 2px 10px' }}>
          {notice}
        </p>
      )}
      <div className="card-list">
        <Row
          icon={<CloudUploadIcon size={21} style={{ color: '#eab308' }} />}
          label="Backup Data"
          value={busy === 'backup' ? 'Preparing…' : undefined}
          onClick={() => void runBackup()}
        />
        <Row
          icon={<RestoreIcon size={21} style={{ color: 'var(--green)' }} />}
          label="Restore Data"
          onClick={() => fileInput.current?.click()}
        />
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file twice still fires a change event.
          e.target.value = '';
          if (file) void inspectFile(file);
        }}
      />

      <SectionLabel>Security</SectionLabel>
      <div className="card-list">
        <Row
          icon={<KeyIcon size={21} />}
          label="Change PIN"
          onClick={() => navigate('/settings/pin')}
        />
        <Row icon={<LockIcon size={21} />} label="Lock App" onClick={lock} />
        <Row
          icon={<LogoutIcon size={21} />}
          label="Logout"
          onClick={() => setConfirmLogout(true)}
        />
      </div>

      <div className="brand-footer">
        <span style={{ display: 'block', color: 'var(--text)', fontWeight: 700 }}>
          {me.group.name}
        </span>
        <strong>Ledger+</strong>
        Powered by Trackmarg
        {/* So support can ask "what does the bottom of your Settings say?" and get an answer
            that ties the device back to an exact commit. */}
        <span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 12, marginTop: 4 }}>
          Build {BUILD_ID}
        </span>
      </div>

      {pendingFile && (
        <ConfirmSheet
          title="Restore this backup?"
          body={
            <>
              <strong>{pendingFile.entries}</strong>{' '}
              {pendingFile.entries === 1 ? 'entry' : 'entries'} from{' '}
              <strong>{pendingFile.from}</strong> will be added to your current session.
              Nothing already in your ledger is removed or changed, and entries this
              partnership has restored before are skipped.
            </>
          }
          confirmLabel="Restore"
          tone="primary"
          busy={restoring}
          onConfirm={runRestore}
          onCancel={() => setPendingFile(null)}
        />
      )}

      {confirmLogout && (
        <ConfirmSheet
          title="Log out of Ledger+?"
          body="This device will be signed out. You will need your group code, phone number and PIN to sign back in. Nothing in the ledger is deleted."
          confirmLabel="Log out"
          onConfirm={() => void logout()}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button className="row" onClick={onClick}>
      <span className="row-icon">{icon}</span>
      <span className="row-label">{label}</span>
      {value && <span className="row-value">{value}</span>}
      <ChevronRightIcon className="row-chevron" />
    </button>
  );
}
