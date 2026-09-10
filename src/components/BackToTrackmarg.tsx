import { ChevronLeftIcon } from './Icons';
import { trackmargReturnUrl } from '../lib/trackmarg';

/// The way back to TrackMarg, for someone who arrived from it.
///
/// Renders nothing unless this visit actually came from TrackMarg (see trackmargReturnUrl).
/// The sign-in screen is a signed-off design; a control that appeared for everybody would
/// change it for everybody, including the people who opened the app directly and have nowhere
/// to go back to.
///
/// Labelled "Back to TrackMarg" rather than "Back to Dashboard" on purpose - Ledger+ has a
/// dashboard of its own, so the shorter label would read as the home screen of the app you are
/// already in, which is the opposite of what this does.
///
/// Positioned absolutely rather than placed in the flow, so the centred stack behind it -
/// title, tagline, both buttons, the sign-in line - keeps the exact spacing it was signed off
/// with instead of being nudged down by a new first child.
export function BackToTrackmarg() {
  const url = trackmargReturnUrl();
  if (!url) return null;

  return (
    <a className="auth-back" href={url}>
      <ChevronLeftIcon size={17} />
      <span>Back to TrackMarg</span>
    </a>
  );
}
