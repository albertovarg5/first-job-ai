import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import AddToResumeDialog from '../components/AddToResumeDialog.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { EmptyState, Field, ModeNotice, PageHeader, Spinner } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { EXPERIENCE_CATEGORIES } from '../lib/translator.js';
import { rewriteExperience } from '../lib/rewrite.js';
import { timeAgo } from '../lib/utils.js';

const EXAMPLES = {
  school: 'I worked on a school project with three people and created a website for a local nonprofit using HTML and CSS.',
  volunteer: 'I volunteer at the food bank on Saturdays. I sort donations and help families find what they need.',
  job: 'I was a barista at a coffee shop. I made drinks, handled the register and trained two new employees.',
  team: 'Me and my friends made a mobile app for our hackathon using React Native.',
  leadership: 'I was in charge of the robotics club social media and planned our monthly meetings.',
  personal: 'I built a budgeting spreadsheet in Google Sheets to track my expenses.',
  other: 'I took care of my younger siblings after school and helped them with homework.',
};

const categoryLabel = (v) => EXPERIENCE_CATEGORIES.find((c) => c.value === v)?.label || 'Experience';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function ExperienceTranslator() {
  const { data, actions, aiActive, aiStatus } = useAppData();
  const toast = useToast();
  const [category, setCategory] = useState('school');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { bullets, prompts, mode, id? }
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const translate = async (e) => {
    e?.preventDefault();
    if (input.trim().length < 10) {
      setError('Describe the experience in at least one full sentence.');
      return;
    }
    setError('');
    setLoading(true);
    const res = await rewriteExperience(input, category, aiActive);
    setLoading(false);
    if (res.fallbackReason) toast.error(`AI unavailable, used Basic mode instead. ${res.fallbackReason}`);
    if (!res.bullets.length) {
      setError('Nothing to translate yet. Try writing a complete sentence about what you did.');
      return;
    }
    setResult({ ...res, id: null });
  };

  const setBullet = (i, value) => setResult((r) => ({ ...r, bullets: r.bullets.map((b, j) => (j === i ? value : b)) }));
  const removeBullet = (i) => setResult((r) => ({ ...r, bullets: r.bullets.filter((_, j) => j !== i) }));
  const addBullet = () => setResult((r) => ({ ...r, bullets: [...r.bullets, ''] }));
  const cleanBullets = () => (result?.bullets || []).map((b) => b.trim()).filter(Boolean);

  const save = () => {
    const bullets = cleanBullets();
    if (!bullets.length) {
      toast.error('Add at least one bullet before saving.');
      return;
    }
    const isNew = !result.id;
    const record = actions.saveTranslation({ id: result.id || undefined, category, input, bullets, mode: result.mode });
    setResult((r) => ({ ...r, id: record.id }));
    if (isNew) actions.logActivity('translation', `Translated a ${categoryLabel(category).toLowerCase()} into resume language`);
    toast.success(isNew ? 'Saved to your library.' : 'Library entry updated.');
  };

  const copy = async (bullets) => {
    const ok = await copyText(bullets.map((b) => `• ${b}`).join('\n'));
    if (ok) toast.success('Copied to clipboard.');
    else toast.error('Your browser blocked copying. Select the text and copy it manually.');
  };

  const openSaved = (t) => {
    setCategory(t.category);
    setInput(t.input);
    setResult({ bullets: t.bullets, prompts: [], mode: t.mode, id: t.id });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="translator-page">
      <PageHeader
        title="Experience Translator"
        description="Describe something you’ve done in everyday words. Get professional resume bullets you can edit — built only from what you wrote."
      />

      <ModeNotice
        aiActive={aiActive}
        aiStatus={aiStatus}
        basicText="Translations use a built-in rewriter that changes wording and structure only. It never adds numbers, results or responsibilities."
      />

      <div className="translator-grid">
        <form className="panel panel-pad" onSubmit={translate} noValidate>
          <h2 className="mb-12">Your experience</h2>
          <Field label="Type of experience">
            <div className="chip-row" role="radiogroup" aria-label="Type of experience">
              {EXPERIENCE_CATEGORIES.map((c) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={category === c.value}
                  key={c.value}
                  className={`chip-btn ${category === c.value ? 'selected' : ''}`}
                  onClick={() => setCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="What did you do?" id="tr-input" error={error} hint="Write naturally. Include who you worked with, what you made or did, and any tools — only what’s true.">
            <textarea
              id="tr-input"
              className="textarea"
              rows={7}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError('');
              }}
              placeholder={EXAMPLES[category]}
            />
          </Field>
          <div className="row-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Spinner /> : <Icon name={aiActive ? 'spark' : 'translator'} size={16} />}
              {loading ? 'Translating…' : 'Translate'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setInput(EXAMPLES[category]);
                setError('');
              }}
            >
              Use an example
            </button>
          </div>
        </form>

        <section className="panel panel-pad result-panel" aria-live="polite">
          <div className="result-head">
            <h2>Resume version</h2>
            {result && <span className={`badge ${result.mode === 'ai' ? 'badge-accent' : ''}`}>{result.mode === 'ai' ? 'AI' : 'Basic rewrite'}</span>}
          </div>
          {!result ? (
            <EmptyState icon="translator" title="Your bullets will appear here">
              Write about an experience on the left and select Translate. You can edit every word afterward.
            </EmptyState>
          ) : (
            <>
              <p className="subtle mb-12">Edit anything that isn’t quite right. Read each line and make sure it’s true.</p>
              <ol className="edit-bullets">
                {result.bullets.map((b, i) => (
                  <li key={i}>
                    <textarea
                      className="textarea bullet-input"
                      rows={2}
                      value={b}
                      onChange={(e) => setBullet(i, e.target.value)}
                      aria-label={`Bullet ${i + 1}`}
                    />
                    <button type="button" className="icon-btn danger" onClick={() => removeBullet(i)} aria-label={`Remove bullet ${i + 1}`}>
                      <Icon name="x" size={15} />
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addBullet}>
                <Icon name="plus" size={14} /> Add a bullet
              </button>
              {result.prompts?.length > 0 && (
                <div className="suggestion-prompts">
                  <strong>Make it stronger with real details</strong>
                  <ul>
                    {result.prompts.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="row-actions result-actions">
                <button type="button" className="btn btn-primary" onClick={() => (cleanBullets().length ? setAddOpen(true) : toast.error('Add at least one bullet first.'))}>
                  <Icon name="resume" size={15} /> Add to resume
                </button>
                <button type="button" className="btn btn-secondary" onClick={save}>
                  <Icon name="check" size={15} /> {result.id ? 'Update saved' : 'Save to library'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => copy(cleanBullets())}>
                  <Icon name="copy" size={15} /> Copy
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="library">
        <div className="section-title-row">
          <h2>Your library</h2>
          <span className="subtle">{data.translations.length} saved</span>
        </div>
        {data.translations.length === 0 ? (
          <p className="muted small">Saved translations appear here so you can reuse them for different applications.</p>
        ) : (
          <div className="library-grid">
            {data.translations.map((t) => (
              <article className="panel library-item" key={t.id}>
                <div className="library-head">
                  <span className="badge">{categoryLabel(t.category)}</span>
                  <span className="subtle">{timeAgo(t.createdAt)}</span>
                </div>
                <p className="library-original">“{t.input}”</p>
                <ul>
                  {t.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
                <div className="library-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => openSaved(t)}>
                    <Icon name="edit" size={14} /> Edit
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => copy(t.bullets)}>
                    <Icon name="copy" size={14} /> Copy
                  </button>
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => setDeleting(t)}>
                    <Icon name="trash" size={14} /> Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {addOpen && (
        <AddToResumeDialog
          open
          bullets={cleanBullets()}
          category={category}
          resume={data.resume}
          onClose={() => setAddOpen(false)}
          onSave={(nextResume, sectionLabel) => {
            actions.saveResume(nextResume);
            actions.logActivity('resume', `Added translated bullets to ${sectionLabel}`);
            setAddOpen(false);
            toast.success(`Added to ${sectionLabel} on your resume.`);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this translation?"
        message="It will be removed from your library. Anything already added to your resume stays there."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          actions.deleteTranslation(deleting.id);
          if (result?.id === deleting.id) setResult((r) => ({ ...r, id: null }));
          toast.success('Translation deleted.');
          setDeleting(null);
        }}
      />
      <p className="subtle page-foot">
        Want to see the result in context? <Link to="/resume?tab=preview">Preview your resume</Link>.
      </p>
    </div>
  );
}
