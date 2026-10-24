import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Logo } from '../components/AppLayout.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { translateExperience } from '../lib/translator.js';

const EXAMPLES = [
  'I worked on a school project with three people and created a website.',
  'I was a cashier at a grocery store. I helped customers and talked to my manager about stuff.',
  'Me and my friends made a Discord bot using Python.',
  'I was in charge of the robotics club social media.',
];

const FEATURES = [
  { icon: 'translator', title: 'Experience Translator', text: 'Turn class projects, volunteering and part-time work into resume language — without inflating anything.' },
  { icon: 'resume', title: 'Resume Builder', text: 'Fill in guided sections, see a live preview, compare against a job post, and download a clean PDF.' },
  { icon: 'search', title: 'Real job search', text: 'Search current listings, save the ones you like and add them to your tracker in one click.' },
  { icon: 'tracker', title: 'Job Tracker', text: 'Keep every application, link, note and interview date in one list or board.' },
  { icon: 'letter', title: 'Cover letters', text: 'Draft a letter for a specific job using only the experience on your resume.' },
  { icon: 'interview', title: 'Interview Practice', text: 'Answer real interview questions for your target role and get structured feedback.' },
  { icon: 'missions', title: 'Career Missions', text: 'Three small tasks a day so your search keeps moving, even on busy weeks.' },
  { icon: 'compass', title: 'Career Assistant', text: 'See which jobs overlap with your resume and the transferable skills your experience already shows.' },
];

const STEPS = [
  { title: 'Tell us where you are', text: 'Student, new grad or switching careers — and the kind of role you want.' },
  { title: 'Build your resume from what you have done', text: 'The translator and builder help you describe real experience well.' },
  { title: 'Apply, track and practice', text: 'Log applications, prepare for interviews and keep a daily rhythm.' },
];

function LiveDemo() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [exampleIndex, setExampleIndex] = useState(0);
  const result = useMemo(() => translateExperience(text), [text]);

  const nextExample = () => {
    const i = (exampleIndex + 1) % EXAMPLES.length;
    setExampleIndex(i);
    setText(EXAMPLES[i]);
  };

  return (
    <div className="demo" aria-label="Try the Experience Translator">
      <div className="demo-in">
        <div className="demo-label-row">
          <label htmlFor="demo-input" className="demo-label">How you'd say it</label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={nextExample}>
            <Icon name="refresh" size={14} /> Another example
          </button>
        </div>
        <textarea id="demo-input" className="demo-textarea" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={400} />
      </div>
      <div className="demo-out" aria-live="polite">
        <span className="demo-label">How it reads on a resume</span>
        {result.bullets.length ? (
          <ul className="demo-bullets">
            {result.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="demo-empty">Type a sentence about something you did.</p>
        )}
        <p className="demo-note">
          Runs in your browser with the built-in rewriter. It rephrases what you wrote and never adds numbers or results you didn't mention.
        </p>
      </div>
    </div>
  );
}

export default function Landing() {
  const { data, mode } = useAppData();
  const { serverAvailable } = useAuth();
  const hasProfile = Boolean(data.profile);
  const ctaTo = hasProfile ? '/dashboard' : '/onboarding';
  const ctaLabel = hasProfile ? 'Open your dashboard' : 'Get started — it’s free';

  return (
    <div className="landing">
      <header className="landing-nav">
        <Logo />
        <nav className="landing-links" aria-label="Page sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#honest">Our approach</a>
        </nav>
        <div className="landing-nav-actions">
          {mode === 'guest' && serverAvailable && (
            <Link to="/signin" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
          )}
          <Link to={ctaTo} className="btn btn-primary btn-sm">
            {hasProfile ? 'Open app' : 'Get started'}
          </Link>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">For students, new grads and career changers</p>
          <h1 className="hero-title">You have more experience than you think.</h1>
          <p className="hero-sub">
            First Job AI helps you describe what you’ve already done, build a resume that reads professionally, and stay organized until you get the offer.
          </p>
          <div className="hero-ctas">
            <Link to={ctaTo} className="btn btn-primary btn-lg">
              {ctaLabel}
            </Link>
            <a href="#features" className="btn btn-secondary btn-lg">
              See what’s inside
            </a>
          </div>
          <p className="hero-fine">No account needed — start as a guest and your data stays in this browser. Create a free account anytime to use it on any device.</p>
        </div>
        <LiveDemo />
      </section>

      <section id="features" className="landing-section">
        <div className="section-head">
          <h2>Everything for your first job search, in one place</h2>
          <p className="muted">Tools that work together, built around what entry-level candidates actually struggle with.</p>
        </div>
        <div className="feature-list">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <span className="feature-icon">
                <Icon name={f.icon} size={18} />
              </span>
              <div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="landing-section">
        <div className="section-head">
          <h2>How it works</h2>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="honest" className="landing-section honest">
        <div className="honest-inner">
          <h2>Built not to exaggerate</h2>
          <div className="honest-points">
            <p>
              <strong>Your facts only.</strong> The tools rephrase and organize what you enter. They never invent numbers, results or job duties.
            </p>
            <p>
              <strong>Clear about AI.</strong> When an AI model is connected, results are labeled. Without one, the app runs in Basic mode and says so.
            </p>
            <p>
              <strong>Private by default.</strong> As a guest, everything stays in your browser. With an account, your data is stored on the app’s server and only you can see it. Text is only sent to an AI provider when you use an AI feature.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <h2>Start with one experience. Leave with a resume.</h2>
        <Link to={ctaTo} className="btn btn-primary btn-lg">
          {ctaLabel}
        </Link>
      </section>

      <footer className="landing-footer">
        <Logo />
        <span className="subtle">Made for first-time job seekers.</span>
      </footer>
    </div>
  );
}
