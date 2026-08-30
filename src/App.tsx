import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import { AppProvider, useApp } from './state/AppContext';
import { BottomNav } from './components/BottomNav';
import { Spinner } from './components/ui';
import { WelcomeScreen } from './screens/auth/WelcomeScreen';
import { LockScreen } from './screens/auth/LockScreen';
import { FrozenScreen } from './screens/FrozenScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LedgerScreen } from './screens/LedgerScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AddTransactionScreen } from './screens/AddTransactionScreen';
import { RecordSettleScreen } from './screens/RecordSettleScreen';
import { ManagePartnersScreen } from './screens/settings/ManagePartnersScreen';
import { DeletedRecordsScreen } from './screens/settings/DeletedRecordsScreen';
import {
  SettlementDetailScreen,
  SettlementListScreen,
} from './screens/settings/SettlementDetailsScreen';
import { ChangePinScreen } from './screens/settings/ChangePinScreen';
import { SupportConsole } from './screens/SupportConsole';
import { UpdateBanner } from './components/UpdateBanner';
import { OfflineBanner } from './components/OfflineBanner';
import { useAppUpdate } from './lib/version';

// The four tabbed screens keep the bottom bar; anything pushed on top of them (Add
// Transaction, Record Settle, the Settings sub-pages) is full-screen with its own header, so
// the nav does not compete with the action the user is in the middle of.
const TABBED = ['/', '/ledger', '/reports', '/settings'];

/// A single-page app keeps the window's scroll position across navigations, so opening Add
/// Transaction from halfway down a long ledger landed you halfway down the form. Going
/// forward always starts a screen at the top; going back restores where you were, so
/// returning to the ledger does not throw away your place in it.
function ScrollBehaviour() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const previous = useRef(pathname);

  // Layout effect, not effect: this runs before the browser paints, so the new screen is
  // never briefly visible at the old scroll offset.
  useLayoutEffect(() => {
    if (previous.current !== pathname) {
      positions.current.set(previous.current, window.scrollY);
      previous.current = pathname;
    }
    const restored = navigationType === 'POP' ? positions.current.get(pathname) : 0;
    window.scrollTo(0, restored ?? 0);
  }, [pathname, navigationType]);

  // Track scrolling on the current screen so there is something to restore on the way back.
  useEffect(() => {
    const onScroll = () => positions.current.set(pathname, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  return null;
}

function Shell() {
  const { status } = useApp();
  const update = useAppUpdate();
  const location = useLocation();
  const navigate = useNavigate();
  const wasReady = useRef(false);

  // Signing in, unlocking with the PIN, or being handed an account by support all land on the
  // dashboard. Without this the app resumes wherever it happened to be when it locked - open
  // Deleted Records, lock, unlock, and you are staring at Deleted Records again. Home is the
  // answer to "what is the state of the business", which is why anyone opens the app.
  //
  // Only on the transition INTO ready, so ordinary navigation once inside is untouched.
  useEffect(() => {
    if (status === 'ready' && !wasReady.current) {
      wasReady.current = true;
      // replace, not push: the lock screen must not be somewhere Back can return to.
      navigate('/', { replace: true });
    } else if (status !== 'ready') {
      wasReady.current = false;
    }
  }, [status, navigate]);

  if (update.required) return <UpdateBanner update={update} />;

  if (status === 'booting') {
    return (
      <div className="shell">
        <Spinner />
      </div>
    );
  }

  if (status === 'signed-out') return <WelcomeScreen />;
  // Ahead of the lock screen: a frozen partnership has nothing to unlock into.
  if (status === 'frozen') return <FrozenScreen />;
  if (status === 'locked') return <LockScreen />;

  return (
    <div className="shell">
      <ScrollBehaviour />
      <UpdateBanner update={update} />
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/ledger" element={<LedgerScreen />} />
        <Route path="/reports" element={<ReportsScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />

        <Route path="/add" element={<AddTransactionScreen />} />
        <Route path="/settle" element={<RecordSettleScreen />} />

        <Route path="/settings/partners" element={<ManagePartnersScreen />} />
        <Route path="/settings/deleted" element={<DeletedRecordsScreen />} />
        <Route path="/settings/settlements" element={<SettlementListScreen />} />
        <Route path="/settings/settlements/:id" element={<SettlementDetailScreen />} />
        <Route path="/settings/pin" element={<ChangePinScreen />} />

        {/* No 404 page - an unknown path in a four-tab app is a mistake, not a destination. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {TABBED.includes(location.pathname) && <BottomNav />}
    </div>
  );
}

/// The support console lives at `#/support` (and `/support`), outside the router and outside
/// AppProvider entirely.
///
/// The hash form is what the operator types, and it is a fragment rather than a path, so
/// BrowserRouter never sees it - hence the check here rather than a <Route>. Keeping it above
/// the provider also means the console never touches a partner session: it has its own token
/// and its own auth, and nothing about the client app boots behind it.
function useIsSupportRoute(): boolean {
  const matches = () =>
    window.location.hash.replace(/^#/, '').replace(/\/$/, '') === '/support' ||
    window.location.pathname.replace(/\/$/, '') === '/support';

  const [isSupport, setIsSupport] = useState(matches);

  useEffect(() => {
    // A hash change does not remount anything on its own, so typing #/support into the bar of
    // an already-open tab would otherwise appear to do nothing.
    const onHashChange = () => setIsSupport(matches());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return isSupport;
}

export default function App() {
  if (useIsSupportRoute()) return <SupportConsole />;

  return (
    <BrowserRouter>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  );
}
