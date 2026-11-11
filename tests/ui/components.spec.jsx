import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, Field, Segmented, Spinner } from '../../src/components/ui.jsx';
import NotFound from '../../src/pages/NotFound.jsx';

describe('reusable components (props)', () => {
  it('EmptyState shows its title, children and action', () => {
    render(<EmptyState title="Nothing yet" action={<button>Add one</button>}>Try adding something.</EmptyState>);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByText('Try adding something.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument();
  });

  it('Field shows a hint, and an error message instead when one is passed', () => {
    const { rerender } = render(<Field label="Email" id="e" hint="We never share it"><input id="e" /></Field>);
    expect(screen.getByText('We never share it')).toBeInTheDocument();
    rerender(<Field label="Email" id="e" error="Enter an email"><input id="e" /></Field>);
    expect(screen.getByText('Enter an email')).toBeInTheDocument();
  });

  it('Spinner uses the label prop', () => {
    render(<Spinner label="Searching" />);
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument();
  });

  it('Segmented calls onChange with the clicked option', async () => {
    const onChange = vi.fn();
    render(<Segmented label="View" value="a" onChange={onChange} options={[{ value: 'a', label: 'List' }, { value: 'b', label: 'Board' }]} />);
    await userEvent.click(screen.getByRole('tab', { name: /Board/ }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('local useState: a component updates its own state on click', async () => {
    function Counter() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>Clicked {n}</button>;
    }
    render(<Counter />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('Clicked 1');
  });
});

describe('404 route', () => {
  it('an unknown URL renders the NotFound page with a link back to the dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/this-page-does-not-exist']}>
        <Routes>
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('This page doesn’t exist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
