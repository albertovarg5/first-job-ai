import Icon from './Icon.jsx';

// Renders either AI feedback or the automated checklist, always labeled.
export default function FeedbackView({ feedback }) {
  if (!feedback) return null;

  if (feedback.mode === 'ai') {
    return (
      <div className="feedback feedback-ai">
        <div className="feedback-head">
          <span className="badge badge-accent">
            <Icon name="spark" size={12} /> AI feedback
          </span>
          {feedback.model && <span className="subtle">{feedback.model}</span>}
        </div>
        <p>{feedback.summary}</p>
        {feedback.strengths?.length > 0 && (
          <div className="feedback-group">
            <h4>What worked</h4>
            <ul>
              {feedback.strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {feedback.improvements?.length > 0 && (
          <div className="feedback-group">
            <h4>What to improve</h4>
            <ul>
              {feedback.improvements.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {typeof feedback.example === 'string' && feedback.example.trim() && (
          <div className="feedback-group">
            <h4>A stronger structure, using your details</h4>
            <p className="feedback-example">{feedback.example}</p>
            <p className="subtle">Fill in anything in [brackets] with what really happened — don’t add details that aren’t true.</p>
          </div>
        )}
        {feedback.nextStep && (
          <p className="feedback-next">
            <strong>Try next:</strong> {feedback.nextStep}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="feedback feedback-checklist">
      <div className="feedback-head">
        <span className="badge">Automated checklist — not AI</span>
        <span className="subtle">
          {feedback.passed} of {feedback.total} checks passed
        </span>
      </div>
      <ul className="checklist">
        {feedback.checks.map((c) => (
          <li key={c.label} className={c.passed ? 'pass' : 'fail'}>
            <span className="check-icon">
              <Icon name={c.passed ? 'check' : 'alert'} size={13} strokeWidth={2.2} />
            </span>
            <span>
              <strong>{c.label}.</strong> {c.tip}
            </span>
          </li>
        ))}
      </ul>
      {feedback.fallbackReason && <p className="subtle">AI was unavailable ({feedback.fallbackReason}), so the checklist was used.</p>}
    </div>
  );
}
