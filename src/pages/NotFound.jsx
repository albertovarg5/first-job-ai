import { Link } from 'react-router-dom';
import { Logo } from '../components/AppLayout.jsx';
import { EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="not-found">
      <Logo />
      <EmptyState
        icon="search"
        title="This page doesn’t exist"
        action={
          <Link to="/dashboard" className="btn btn-primary">
            Go to dashboard
          </Link>
        }
      >
        The link may be mistyped, or the page may have moved.
      </EmptyState>
    </div>
  );
}
