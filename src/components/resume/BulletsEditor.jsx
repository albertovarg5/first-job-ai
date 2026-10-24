import { useState } from 'react';
import Icon from '../Icon.jsx';
import { Field, Spinner } from '../ui.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { rewriteExperience } from '../../lib/rewrite.js';

// Textarea for bullet points (one per line) with an "Improve wording" helper
// that suggests a rewrite the user can accept or discard.
export default function BulletsEditor({ id, value, onChange, category, label = 'What you did', hint }) {
  const { aiActive } = useAppData();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  const improve = async () => {
    if (!value?.trim()) {
      toast.info('Write a few lines about what you did first, then improve the wording.');
      return;
    }
    setLoading(true);
    const result = await rewriteExperience(value, category, aiActive);
    setLoading(false);
    if (result.fallbackReason) toast.error(`AI unavailable, used Basic mode instead. ${result.fallbackReason}`);
    setSuggestion(result);
  };

  return (
    <div className="bullets-editor">
      <Field
        label={label}
        id={id}
        hint={hint || 'One bullet per line. Plain language is fine — use “Improve wording” to polish it.'}
      >
        <textarea id={id} className="textarea" rows={4} value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="bullets-tools">
        <button type="button" className="btn btn-secondary btn-sm" onClick={improve} disabled={loading}>
          {loading ? <Spinner label="Improving" /> : <Icon name={aiActive ? 'spark' : 'translator'} size={14} />}
          {loading ? 'Improving…' : 'Improve wording'}
        </button>
        <span className="subtle">{aiActive ? 'Uses AI' : 'Basic mode — rule-based, no AI'}</span>
      </div>
      {suggestion && (
        <div className="suggestion">
          <div className="suggestion-head">
            <span className={`badge ${suggestion.mode === 'ai' ? 'badge-accent' : ''}`}>
              {suggestion.mode === 'ai' ? 'AI suggestion' : 'Basic rewrite'}
            </span>
            <span className="subtle">Check that every word is true before you use it.</span>
          </div>
          <ul>
            {suggestion.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          {suggestion.prompts?.length > 0 && (
            <div className="suggestion-prompts">
              <strong>Could you add real detail?</strong>
              <ul>
                {suggestion.prompts.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="suggestion-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                onChange(suggestion.bullets.join('\n'));
                setSuggestion(null);
                toast.success('Bullets updated.');
              }}
            >
              Use these bullets
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSuggestion(null)}>
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
