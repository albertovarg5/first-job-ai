// Job Search page: loading state, error state and success, with fetch() faked
// and the three context hooks replaced by fixed values.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/context/AppDataContext.jsx', () => ({ useAppData: () => ({ data: { savedJobs: [], profile: {}, applications: [] }, actions: {} }) }));
vi.mock('../../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 1 }, requireAuthForApis: false }) }));
vi.mock('../../src/context/ToastContext.jsx', () => ({ useToast: () => ({ success() {}, error() {}, info() {} }) }));

const { default: JobSearch } = await import('../../src/pages/JobSearch.jsx');

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const job = { id: 'j1', title: 'CS Specialist', employer: 'Pie Insurance', location: 'Anywhere', remote: true, employmentTypes: ['Full-time'], highlights: {}, description: 'A remote role.', applyLink: 'https://example.com/apply' };

function stubFetch(searchHandler) {
  vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('/api/jobs/status') ? Promise.resolve(reply(200, { configured: true })) : searchHandler(url))));
}
async function search() {
  render(<MemoryRouter><JobSearch /></MemoryRouter>);
  await userEvent.type(await screen.findByLabelText(/Job title or keywords/), 'cs');
  await userEvent.click(screen.getByRole('button', { name: /Search jobs/ }));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Job Search page', () => {
  it('shows a loading state, then the results', async () => {
    let finish;
    stubFetch(() => new Promise((r) => { finish = () => r(reply(200, { jobs: [job], page: 1, hasMore: false })); }));
    await search();
    expect(await screen.findByText('Searching job listings…')).toBeInTheDocument();
    finish();
    expect(await screen.findByText('CS Specialist')).toBeInTheDocument();
  });

  it('shows a clear error when the search fails', async () => {
    stubFetch(() => Promise.resolve(reply(429, { error: 'Too many searches. Try again later.', code: 'rate_limited' })));
    await search();
    expect(await screen.findByText('Search limit reached')).toBeInTheDocument();
    expect(screen.getByText(/Too many searches/)).toBeInTheDocument();
  });
});
