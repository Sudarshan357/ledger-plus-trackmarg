import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { SnowflakeIcon } from '../components/Icons';

/// Shown when support has frozen the partnership. Nothing else renders behind it, because
/// there is nothing to render: the API refuses every ledger route with a 423 while frozen, so
/// this is not an overlay hiding data that is still loaded - the data never arrives.
///
/// It re-checks on its own. The push down the SSE channel handles the common case instantly,
/// but a device that reloaded while frozen has no open stream to be pushed to, and telling a
/// locked-out client "reload and hope" is not good enough.
const RETRY_MS = 15000;

export function FrozenScreen() {
  const { retryFrozen, logout } = useApp();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => void retryFrozen(), RETRY_MS);
    return () => clearInterval(timer);
  }, [retryFrozen]);

  const checkNow = async () => {
    setChecking(true);
    try {
      await retryFrozen();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="frozen">
      <div className="frozen-mark">
        <SnowflakeIcon size={54} />
      </div>

      <h1 className="frozen-title">Your account has been frozen by our support console</h1>
      <p className="frozen-body">
        Your data is safe with us. Contact our support team immediately for recovery.
      </p>

      <div className="frozen-actions">
        <button className="btn btn--ghost" onClick={checkNow} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        <button className="link-button" onClick={() => void logout()} style={{ marginTop: 18 }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
