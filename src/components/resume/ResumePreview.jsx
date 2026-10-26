import { dateRange, resumeLayout } from '../../lib/resume.js';
import { linesOf } from '../../lib/utils.js';

function Bullets({ text }) {
  const lines = linesOf(text);
  if (!lines.length) return null;
  return (
    <ul>
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function Entry({ title, dates, subtitle, children }) {
  return (
    <div className="rp-entry">
      <div className="rp-entry-head">
        <strong>{title}</strong>
        {dates && <span>{dates}</span>}
      </div>
      {subtitle && <em>{subtitle}</em>}
      {children}
    </div>
  );
}

// On-screen preview that mirrors the PDF layout: same template, density and
// section order (resumeLayout), so the download matches what you see.
export default function ResumePreview({ resume }) {
  const c = resume.contact || {};
  const { template, density, order } = resumeLayout(resume);
  const contact = [c.email, c.phone, c.location, c.linkedin, c.website].filter(Boolean);
  const education = (resume.education || []).filter((e) => e.school || e.degree);
  const experience = (resume.experience || []).filter((e) => e.role || e.org);
  const projects = (resume.projects || []).filter((p) => p.name);
  const volunteering = (resume.volunteering || []).filter((e) => e.role || e.org);
  const achievements = (resume.achievements || []).filter((a) => a.title);
  const roles = (title, list) =>
    list.length > 0 && (
      <section key={title}>
        <h3>{title}</h3>
        {list.map((e) => (
          <Entry key={e.id} title={[e.role, e.org].filter(Boolean).join(' – ')} dates={dateRange(e.start, e.end)} subtitle={e.location}>
            <Bullets text={e.bullets} />
          </Entry>
        ))}
      </section>
    );

  const sections = {
    summary: resume.summary?.trim() && (
      <section key="summary">
        <h3>Summary</h3>
        <p>{resume.summary}</p>
      </section>
    ),
    education: education.length > 0 && (
      <section key="education">
        <h3>Education</h3>
        {education.map((e) => (
          <Entry key={e.id} title={e.school} dates={dateRange(e.start, e.end)} subtitle={[e.degree, e.field].filter(Boolean).join(', ')}>
            <Bullets text={e.details} />
          </Entry>
        ))}
      </section>
    ),
    experience: roles('Experience', experience),
    projects: projects.length > 0 && (
      <section key="projects">
        <h3>Projects</h3>
        {projects.map((p) => (
          <Entry key={p.id} title={p.name} dates={dateRange(p.start, p.end)} subtitle={[p.role, p.link].filter(Boolean).join('  |  ')}>
            <Bullets text={p.bullets} />
          </Entry>
        ))}
      </section>
    ),
    volunteering: roles('Volunteering', volunteering),
    skills: resume.skills?.length > 0 && (
      <section key="skills">
        <h3>Skills</h3>
        <p>{resume.skills.join(', ')}</p>
      </section>
    ),
    achievements: achievements.length > 0 && (
      <section key="achievements">
        <h3>Achievements</h3>
        {achievements.map((a) => (
          <Entry key={a.id} title={a.title} dates={a.date}>
            {a.description && <p>{a.description}</p>}
          </Entry>
        ))}
      </section>
    ),
  };

  return (
    <article className={`resume-paper tpl-${template} density-${density}`} aria-label="Resume preview">
      <header className="rp-header">
        <h2>{c.fullName || 'Your Name'}</h2>
        {contact.length > 0 && (
          <p className="rp-contact">
            {contact.map((item, i) => (
              <span key={i}>{item}</span>
            ))}
          </p>
        )}
      </header>
      {order.map((id) => sections[id])}
    </article>
  );
}
