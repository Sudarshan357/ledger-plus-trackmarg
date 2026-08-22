import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'ledgerplus.theme';

// Must match the --bg token for each palette in styles.css. These drive the browser chrome
// (the address bar and status bar on mobile), and a mismatch shows as a visible seam above
// the page - the one bit of the window CSS cannot reach.
const CHROME: Record<'light' | 'dark', string> = {
  light: '#f6f7f9',
  dark: '#0d1117',
};

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'dark' || saved === 'light' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/// The theme actually on screen right now, with 'system' resolved.
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;

  // 'system' REMOVES the attribute rather than setting a value. That hands the decision back
  // to the prefers-color-scheme rules in the stylesheet, so the app keeps following the phone
  // even if it is switched to dark later in the evening while the app is still open.
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  // Collapse the two media-scoped theme-color tags down to a single resolved one. Left as
  // they are, an explicit choice that disagrees with the OS leaves the browser chrome
  // showing the other theme.
  document.querySelectorAll('meta[name="theme-color"]').forEach((tag) => tag.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = CHROME[resolveTheme(choice)];
  document.head.appendChild(meta);

  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable - the choice just will not survive a reload */
  }
}

/// Reads and sets the theme. `resolved` is what is currently on screen, which the UI needs in
/// order to say "System (Dark)" rather than leaving the user guessing what System resolved to.
export function useTheme(): {
  choice: ThemeChoice;
  resolved: 'light' | 'dark';
  setChoice: (next: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(readTheme);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(readTheme()));

  const setChoice = useCallback((next: ThemeChoice) => {
    applyTheme(next);
    setChoiceState(next);
    setResolved(resolveTheme(next));
  }, []);

  // While on 'system', track the OS flipping underneath us.
  useEffect(() => {
    if (choice !== 'system') return;
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => {
      setResolved(resolveTheme('system'));
      applyTheme('system');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  return { choice, resolved, setChoice };
}
