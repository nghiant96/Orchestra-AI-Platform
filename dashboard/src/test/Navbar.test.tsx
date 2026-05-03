import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Navbar } from '../components/Navbar';

describe('Navbar workspace registration', () => {
  it('submits a workspace registration request from the UI', async () => {
    const onRegisterWorkspace = vi.fn().mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <Navbar
          searchTerm=""
          setSearchTerm={vi.fn()}
          fetchJobs={vi.fn()}
          loading={false}
          allowedWorkdirs={['/Users/me/project']}
          currentProject="/Users/me/project"
          onProjectChange={vi.fn()}
          onRegisterWorkspace={onRegisterWorkspace}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    fireEvent.change(screen.getByPlaceholderText('/absolute/path/to/workspace'), {
      target: { value: '/Users/me/new-workspace' }
    });
    fireEvent.submit(screen.getByText(/register workspace/i).closest('form')!);

    await waitFor(() => {
      expect(onRegisterWorkspace).toHaveBeenCalledWith('/Users/me/new-workspace');
    });
  });
});
