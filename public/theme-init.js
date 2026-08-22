/*
 * Applies the saved theme BEFORE the page paints.
 *
 * This is a separate file, loaded synchronously from <head>, for two reasons. It has to run
 * before first paint - doing it from the React bundle means the page renders light and then
 * snaps to dark, which is the single thing that makes a dark mode feel bolted on. And it has
 * to be same-origin: the API sets a Content-Security-Policy of script-src 'self', so an
 * inline <script> would be blocked outright.
 *
 * Keep this tiny and dependency-free; it is on the critical path for every page load.
 */
(function () {
  try {
    var saved = localStorage.getItem('ledgerplus.theme');
    // 'system' (or nothing saved) leaves the attribute off, which is what lets the
    // prefers-color-scheme rules in styles.css decide.
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {
    /* private-mode Safari throws on localStorage; the light default is a fine fallback */
  }
})();
