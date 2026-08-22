import { NavLink } from 'react-router-dom';
import { ChartIcon, HomeIcon, ListIcon, SettingsIcon } from './Icons';

const TABS = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/ledger', label: 'Ledger', Icon: ListIcon, end: false },
  { to: '/reports', label: 'Reports', Icon: ChartIcon, end: false },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon, end: false },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
        >
          {({ isActive }) => (
            <>
              {/* The active tab reads as filled by weighting the stroke rather than swapping
                  in a second set of solid glyphs. */}
              <Icon size={23} strokeWidth={isActive ? 2.5 : 1.9} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
