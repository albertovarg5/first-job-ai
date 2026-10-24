import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { PageHeader, Segmented, Spinner } from '../components/ui.jsx';
import { fetchBillingStatus, formatPrice, hasOpenSubscription, openBillingPortal, startCheckout, yearlySaving } from '../lib/billing.js';

// Plans and checkout. Prices come from Stripe (via the server), and whether
// someone is Premium comes only from /api/billing/status. Subscribe sends
// the browser to Stripe Checkout; nothing here grants Premium by itself.
export default function Pricing() {
  const [state, setState] = useState({ loading: true, billing: null, error: '' });
  const [interval, setBillingInterval] = useState('month');
  const [busy, setBusy] = useState(''); // '' | 'checkout' | 'portal'
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      setState({ loading: false, billing: await fetchBillingStatus(), error: '' });
    } catch (err) {
      setState({ loading: false, billing: null, error: err.message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (kind, fn) => {
    setBusy(kind);
    setActionError('');
    try {
      await fn(); // On success the browser is leaving for Stripe, so the button stays busy.
    } catch (err) {
      setActionError(err.message);
      setBusy('');
      if (err.code === 'already_subscribed') load();
    }
  };

  const { billing } = state;
  const limits = billing?.aiLimits || { free: 20, premium: 200 };
  const price = billing?.prices?.[interval] || null;
  const saving = yearlySaving(billing?.prices);
  const isPremium = billing?.plan === 'premium' || hasOpenSubscription(billing);

  return (
    <div className="pricing">
      <PageHeader title="Plans and pricing" description="Every tool in First Job AI is free. Premium gives you more AI help each month." />

      {state.error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={16} /> Plans couldn’t be loaded ({state.error}).{' '}
          <button className="link-btn" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {billing?.testMode && (
        <div className="alert alert-warn">
          <Icon name="info" size={16} /> Test mode: no real charges. Pay with Stripe’s test card 4242 4242 4242 4242.
        </div>
      )}

      <div className="pricing-toggle">
        <Segmented
          label="Billing period"
          value={interval}
          onChange={(v) => {
            setBillingInterval(v);
            setActionError('');
          }}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: saving > 0 ? `Yearly (save ${saving}%)` : 'Yearly' },
          ]}
        />
      </div>

      <div className="pricing-grid">
        <section className="panel pricing-card" aria-labelledby="plan-free">
          <h2 id="plan-free">Free</h2>
          <p className="pricing-price">
            <span className="pricing-amount">$0</span>
          </p>
          <ul className="pricing-list">
            <li>
              <Icon name="check" size={16} /> Every tool: job search, tracker, resume builder, cover letters, interview practice and more
            </li>
            <li>
              <Icon name="check" size={16} /> {limits.free} AI requests a month
            </li>
            <li>
              <Icon name="check" size={16} /> Unlimited Basic mode (the tools without AI)
            </li>
          </ul>
          <div className="pricing-cta">
            {billing && !isPremium && billing.signedIn ? (
              <span className="badge">Your current plan</span>
            ) : (
              <span className="muted small">No card needed</span>
            )}
          </div>
        </section>

        <section className="panel pricing-card pricing-premium" aria-labelledby="plan-premium">
          <h2 id="plan-premium">Premium</h2>
          <p className="pricing-price">
            {state.loading ? (
              <Spinner label="Loading prices" />
            ) : price ? (
              <span className="pricing-amount">{formatPrice(price, interval)}</span>
            ) : (
              <span className="muted">{interval === 'year' ? 'Yearly billing isn’t available yet' : 'Price unavailable'}</span>
            )}
          </p>
          {interval === 'year' && price && <p className="subtle">Billed once a year. {saving > 0 && `That’s ${saving}% less than paying monthly.`}</p>}
          <ul className="pricing-list">
            <li>
              <Icon name="check" size={16} /> Everything in Free
            </li>
            <li>
              <Icon name="check" size={16} />{' '}
              <strong>
                {limits.premium} AI requests a month instead of {limits.free}
              </strong>
            </li>
            <li>
              <Icon name="check" size={16} /> Cancel anytime from Settings
            </li>
          </ul>
          <p className="subtle">AI requests power job analysis, resume suggestions, cover letters, and interview questions and feedback.</p>
          <div className="pricing-cta">
            <PremiumAction billing={billing} loading={state.loading} interval={interval} price={price} isPremium={isPremium} busy={busy} run={run} />
          </div>
          {actionError && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" size={16} /> {actionError}
            </div>
          )}
        </section>
      </div>

      <p className="subtle pricing-foot">
        <Icon name="lock" size={14} /> Payments are handled by Stripe. First Job AI never sees or stores your card details. Failed AI requests don’t count toward your
        allowance, and it resets on the 1st of each month.
      </p>
    </div>
  );
}

function PremiumAction({ billing, loading, interval, price, isPremium, busy, run }) {
  if (loading) return null;
  if (!billing) return null;
  if (!billing.configured) {
    return (
      <>
        <button className="btn btn-primary" disabled>
          Subscribe
        </button>
        <p className="muted small">Payments aren’t set up on this server yet, so Premium can’t be bought right now.</p>
      </>
    );
  }
  if (!billing.signedIn) {
    return (
      <>
        <Link to="/signin" state={{ from: '/pricing' }} className="btn btn-primary">
          Sign in to subscribe
        </Link>
        <p className="muted small">
          Premium is linked to your account. New here? <Link to="/signup">Create a free account</Link>.
        </p>
      </>
    );
  }
  if (isPremium) {
    return (
      <>
        <span className="badge badge-accent">You’re on Premium</span>
        {billing.canManage && (
          <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => run('portal', openBillingPortal)}>
            {busy === 'portal' ? <Spinner /> : <Icon name="external" size={15} />}
            {busy === 'portal' ? 'Opening…' : 'Manage subscription'}
          </button>
        )}
      </>
    );
  }
  return (
    <button className="btn btn-primary btn-lg" disabled={Boolean(busy) || !price} onClick={() => run('checkout', () => startCheckout(interval))}>
      {busy === 'checkout' && <Spinner />}
      {busy === 'checkout' ? 'Opening secure checkout…' : `Subscribe ${interval === 'year' ? 'yearly' : 'monthly'}`}
    </button>
  );
}

// Small prompt on the dashboard for signed-in Free users when Premium can be bought.
export function UpgradeBanner() {
  const [billing, setBilling] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchBillingStatus()
      .then((b) => !cancelled && setBilling(b))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!billing?.configured || !billing.signedIn || billing.plan === 'premium' || hasOpenSubscription(billing)) return null;
  return (
    <section className="panel upgrade-banner" aria-label="Premium">
      <span className="summary-icon" aria-hidden="true">
        <Icon name="spark" size={18} />
      </span>
      <div>
        <strong>Get more AI help with Premium</strong>
        <p className="subtle">
          {billing.aiLimits.premium} AI requests a month instead of {billing.aiLimits.free}. Cancel anytime.
        </p>
      </div>
      <Link to="/pricing" className="btn btn-primary">
        Upgrade to Premium
      </Link>
    </section>
  );
}
