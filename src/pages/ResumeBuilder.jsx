import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { PageHeader, ProgressBar, Segmented } from '../components/ui.jsx';
import ResumePreview from '../components/resume/ResumePreview.jsx';
import TailorPanel from '../components/resume/TailorPanel.jsx';
import { ContactSection, ListSection, SECTIONS, SkillsSection, SummarySection, sectionHasContent } from '../components/resume/ResumeSections.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { resumeChecklist, resumeCompleteness } from '../lib/resume.js';
import { downloadResumePdf } from '../lib/resumePdf.js';
import { timeAgo } from '../lib/utils.js';

const TABS = [
  { value: 'edit', label: 'Edit', icon: 'edit' },
  { value: 'preview', label: 'Preview', icon: 'eye' },
  { value: 'tailor', label: 'Tailor to a job', icon: 'search' },
];

const SECTION_HELP = {
  contact: 'How employers reach you. Use a professional email address.',
  summary: 'A short introduction at the top of your resume.',
  education: 'Schools, degrees and expected graduation dates.',
  experience: 'Jobs you’ve had, including part-time and summer work.',
  projects: 'School, personal and team projects that show your skills.',
  volunteering: 'Unpaid roles where you contributed or led.',
  skills: 'Tools, languages and abilities you could talk about in an interview.',
  achievements: 'Awards, honors, scholarships and certifications.',
};

export default function ResumeBuilder() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const lastLogged = useRef(0);
  const resume = data.resume;

  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'edit';
  const section = SECTIONS.some((s) => s.id === params.get('section')) ? params.get('section') : 'contact';
  const completeness = resumeCompleteness(resume);
  const sectionIndex = SECTIONS.findIndex((s) => s.id === section);

  const go = (next) => setParams(Object.fromEntries(Object.entries({ tab: next.tab ?? tab, section: next.section ?? section }).filter(([, v]) => v)), { replace: true });

  const onChange = (next) => {
    actions.saveResume(next);
    // Log at most one "updated resume" activity every 10 minutes.
    if (Date.now() - lastLogged.current > 10 * 60 * 1000) {
      lastLogged.current = Date.now();
      actions.logActivity('resume', 'Updated your resume');
    }
  };

  const download = () => {
    if (!resume.contact.fullName.trim()) {
      toast.error('Add your full name in Contact before downloading.');
      go({ tab: 'edit', section: 'contact' });
      return;
    }
    try {
      downloadResumePdf(resume);
      actions.logActivity('resume', 'Downloaded your resume as a PDF');
      toast.success('Resume PDF downloaded.');
    } catch (err) {
      toast.error(`Could not create the PDF: ${err.message}`);
    }
  };

  const missing = resumeChecklist(resume).filter((i) => !i.done);

  return (
    <div className="resume-page">
      <PageHeader
        title="Resume Builder"
        description="Fill in each section with what you’ve really done. Changes save automatically."
        actions={
          <button className="btn btn-primary" onClick={download}>
            <Icon name="download" size={16} /> Download PDF
          </button>
        }
      />

      <div className="resume-toolbar">
        <Segmented options={TABS} value={tab} onChange={(v) => go({ tab: v })} label="Resume views" />
        <div className="resume-score">
          <span className="small">
            <strong>{completeness}%</strong> complete
          </span>
          <div className="resume-score-bar">
            <ProgressBar value={completeness} label="Resume completeness" tone={completeness < 40 ? 'warn' : 'accent'} />
          </div>
          <span className="subtle nowrap save-state">
            <Icon name="check" size={13} /> {resume.updatedAt ? `Saved ${timeAgo(resume.updatedAt)}` : 'Saves as you type'}
          </span>
        </div>
      </div>

      {tab === 'edit' && (
        <div className="resume-edit">
          <nav className="section-nav" aria-label="Resume sections">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className={`section-link ${section === s.id ? 'active' : ''}`} onClick={() => go({ section: s.id })}>
                <span className={`section-dot ${sectionHasContent(resume, s.id) ? 'filled' : ''}`}>
                  {sectionHasContent(resume, s.id) && <Icon name="check" size={10} strokeWidth={3} />}
                </span>
                {s.label}
              </button>
            ))}
            {missing.length > 0 && (
              <div className="section-nav-tip">
                <strong>To reach 100%</strong>
                <ul>
                  {missing.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => go({ section: m.section })}>
                        {m.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>

          <section className="panel section-panel" aria-labelledby="section-title">
            <div className="panel-header">
              <div>
                <h2 id="section-title">{SECTIONS[sectionIndex].label}</h2>
                <p className="subtle">{SECTION_HELP[section]}</p>
              </div>
            </div>
            <div className="panel-body">
              {section === 'contact' && <ContactSection resume={resume} onChange={onChange} />}
              {section === 'summary' && <SummarySection resume={resume} onChange={onChange} targetRole={data.profile?.targetRole} />}
              {['education', 'experience', 'projects', 'volunteering', 'achievements'].includes(section) && (
                <ListSection key={section} type={section} resume={resume} onChange={onChange} />
              )}
              {section === 'skills' && <SkillsSection resume={resume} onChange={onChange} />}
            </div>
            <div className="section-pager">
              <button type="button" className="btn btn-ghost" disabled={sectionIndex === 0} onClick={() => go({ section: SECTIONS[sectionIndex - 1].id })}>
                <Icon name="chevronLeft" size={16} /> {sectionIndex > 0 ? SECTIONS[sectionIndex - 1].label : 'Previous'}
              </button>
              {sectionIndex < SECTIONS.length - 1 ? (
                <button type="button" className="btn btn-secondary" onClick={() => go({ section: SECTIONS[sectionIndex + 1].id })}>
                  {SECTIONS[sectionIndex + 1].label} <Icon name="chevronRight" size={16} />
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => go({ tab: 'preview' })}>
                  <Icon name="eye" size={16} /> Preview resume
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'preview' && (
        <div className="preview-wrap">
          <div className="preview-bar">
            <p className="muted small">This is how your PDF will look. It uses a simple one-column layout that applicant tracking systems can read.</p>
            <div className="page-actions">
              <button className="btn btn-secondary" onClick={() => go({ tab: 'edit' })}>
                <Icon name="edit" size={15} /> Keep editing
              </button>
              <button className="btn btn-primary" onClick={download}>
                <Icon name="download" size={15} /> Download PDF
              </button>
            </div>
          </div>
          <ResumePreview resume={resume} />
        </div>
      )}

      {tab === 'tailor' && <TailorPanel resume={resume} />}
    </div>
  );
}
