import { Link, useLocation, useParams } from 'react-router-dom';

// Single row of most important tabs for mobile
const MAIN_TABS = [
  { key: 'dashboard', label: 'Home', to: '/events/:eventId' },
  { key: 'guests', label: 'Guests', to: '/events/:eventId/guests' },
  { key: 'seating', label: 'Seats', to: '/events/:eventId/seating' },
  { key: 'menu', label: 'Food', to: '/events/:eventId/menu' },
  { key: 'ops', label: 'Work', to: '/events/:eventId/ops' },
];

export default function EventTabs({ currentKey, adminOnly = false }) {
  const { eventId } = useParams();
  const location = useLocation();

  const currentPath = location.pathname;

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 min-w-0 scrollbar-hide">
      {MAIN_TABS.map((tab) => {
        const to = tab.to.replace(':eventId', eventId);
        const isActive = currentKey === tab.key || currentPath === to;
        return (
          <Link
            key={tab.key}
            to={to}
            className={`btn btn-sm shrink-0 whitespace-nowrap ${
              isActive ? 'btn-primary' : 'btn-secondary'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
