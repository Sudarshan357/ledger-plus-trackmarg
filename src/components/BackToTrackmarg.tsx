import { ChevronLeftIcon } from './Icons';
import { trackmargReturnUrl } from '../lib/trackmarg';

/// The way back to TrackMarg from the sign-in and lock screens.
///
/// Always shown. It was conditional at first - only for people who arrived from a TrackMarg
/// link - which read as the careful choice but was wrong where it counted: the packaged
/// Android app loads from https://localhost/ with no query string, so the condition could
/// never be true there, and the app is exactly where the button is needed. It draws no
/// browser chrome, so someone on the sign-in screen with a forgotten PIN has no other way out.
///
/// Labelled "Back to TrackMarg" rather than "Back to Dashboard" on purpose - Ledger+ has a
/// dashboard of its own, so the shorter label would read as the home screen of the app you are
/// already in, which is the opposite of what this does.
///
/// Positioned absolutely rather than placed in the flow, so the centred stack behind it -
/// title, tagline, both buttons, the sign-in line - keeps the exact spacing it was signed off
/// with instead of being nudged down by a new first child.
export function BackToTrackmarg() {
  return (
    <a className="auth-back" href={trackmargReturnUrl()}>
      <ChevronLeftIcon size={17} />
      <span>Back to TrackMarg</span>
    </a>
  );
}
