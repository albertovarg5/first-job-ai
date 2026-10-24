import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Spinner } from '../components/ui.jsx';
import { fetchBillingStatus, syncCheckout } from '../lib/billing.js';

const POLL_MS = 2000;
const MAX_TRIES = 10;

// Stripe sends people here after paying. Arriving on this page proves
// nothing, so it asks the server to check the payment with Stripe and only
// shows Premium once the server confirms it.
export function BillingSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id') || '';
  const [state, setState] = useState({ phase: 'checking', message: '' }); // checking | active | pending | error

  useEffect(() => {
    let cancelled = false;
    let timer;
    const check = async (attempt) => {
      try {
        const res = attempt === 0 && sessionId ? await syncCheckout(sessionId) : await fetchBillingStatus();
        if (cancelled) return;
        if (res.plan === 'premium') return setState({ phase: 'active', message: '' });
        if (attempt + 1 >= MAX_TRIES) return setState({ phase: 'pending', message: '' });
        timer = setTimeout(() => check(attempt + 1), POLL_MS);
      } catch (err) {
        if (!cancelled) setState({ phase: 'error', message: err.message });
      }
    };
    check(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  return (
    <div className="panel billing-result" aria-live="polite">
      {state.phase === 'checking' && (
        <>
          <Spinner label="Confirming your payment" />
          <h1>Confirming your payment…</h1>
          <p className="muted">This usually takes a few seconds. Please keep this page open.</p>
        </>
      )}
      {state.phase === 'active' && (
        <>
          <span className="summary-icon" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <h1>Welcome to Premium</h1>
          <p className="muted">Your payment was confirmed by Stripe and your higher AI allowance is active now. You can manage or cancel your subscription anytime in Settings.</p>
          <div className="row-actions center">
            <Link to="/dashboard" className="btn btn-primary">
              Go to your dashboard
            </Link>
            <Link to="/settings#plan" className="btn btn-secondary">
              View your plan
            </Link>
          </div>
        </>
      )}
      {state.phase === 'pending' && (
        <>
          <Icon name="clock" size={28} />
          <h1>Payment received, still confirming</h1>
          <p className="muted">
            Stripe hasn’t confirmed your subscription with us yet. This can take a minute. Premium turns on automatically as soon as it does. Check Settings in a moment. You won’t be charged twice.
          </p>
          <div className="row-actions center">
            <Link to="/settings#plan" className="btn btn-primary">
              Check my plan
            </Link>
          </div>
        </>
      )}
      {state.phase === 'error' && (
        <>
          <Icon name="alert" size={28} />
          <h1>We couldn’t confirm your payment here</h1>
          <p className="muted">{state.message} If you completed checkout, Premium will still turn on automatically once Stripe confirms it.</p>
          <div className="row-actions center">
            <Link to="/settings#plan" className="btn btn-primary">
              Check my plan
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export function BillingCancel() {
  return (
    <div className="panel billing-result">
      <Icon name="info" size={28} />
      <h1>Checkout canceled</h1>
      <p className="muted">You weren’t charged and your plan hasn’t changed. You can upgrade anytime from Plans & Pricing.</p>
      <div className="row-actions center">
        <Link to="/pricing" className="btn btn-primary">
          Back to plans
        </Link>
        <Link to="/dashboard" className="btn btn-secondary">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
