import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// Mock hooks
vi.mock('../hooks/useHealth', () => ({
  useHealth: () => ({
    health: { 
      ok: true, 
      status: 'Active', 
      cwd: '/test', 
      queue: { activeCount: 0, queuedCount: 0 }, 
      version: '1.0.0',
      allowedWorkdirs: ['/test']
    },
    fetchHealth: vi.fn()
  })
}));

vi.mock('../hooks/useJobs', () => ({
  useJobs: () => ({
    loading: false,
    searchTerm: '',
    setSearchTerm: vi.fn(),
    statusFilter: 'all',
    setStatusFilter: vi.fn(),
    stats: { total: 1, running: 0, completed: 1, failed: 0 },
    filteredJobs: [
      { jobId: 'job-1', status: 'completed', task: 'Test Task', cwd: '/test', createdAt: new Date().toISOString() }
    ],
    fetchJobs: vi.fn(),
    submitTask: vi.fn(),
    cancelJob: vi.fn(),
    resumeJob: vi.fn(),
    jobs: [
      { jobId: 'job-1', status: 'completed', task: 'Test Task', cwd: '/test', createdAt: new Date().toISOString() }
    ]
  })
}));

vi.mock('../hooks/useConfig', () => ({
  useConfig: () => ({
    config: { 
      rules: { 
        max_iterations: 3,
        providers: { planner: { type: 'test' } }
      } 
    },
    fetchConfig: vi.fn()
  })
}));

vi.mock('../hooks/useWorkItems', () => ({
  useWorkItems: () => ({
    workItems: [],
    loading: false,
    stats: { total: 0, active: 0, done: 0, failed: 0 },
    fetchWorkItems: vi.fn(),
    assess: vi.fn(),
    run: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    importWorkItem: vi.fn()
  })
}));

vi.mock('../hooks/useAudit', () => ({
  useAudit: () => ({
    events: [
      {
        version: 1,
        id: 'audit-1',
        timestamp: '2026-06-12T00:00:00.000Z',
        action: 'solo.commit',
        actor: { id: 'ai-system-cli', role: 'operator' },
        cwd: '/test',
        jobId: 'job-commit-test',
        details: {
          commitSha: 'abc123',
          summary: 'Committed 1 file(s) for job-commit-test.'
        }
      },
      {
        version: 1,
        id: 'audit-2',
        timestamp: '2026-06-12T01:00:00.000Z',
        action: 'solo.continue',
        actor: { id: 'ai-system-cli', role: 'operator' },
        cwd: '/test',
        jobId: 'job-continued',
        details: {
          sourceJobId: 'job-original',
          fixVerification: true,
          summary: 'Continue Orchestra Solo job job-original.'
        }
      },
      {
        version: 1,
        id: 'audit-3',
        timestamp: '2026-06-12T02:00:00.000Z',
        action: 'solo.commit',
        actor: { id: 'ai-system-cli', role: 'operator' },
        cwd: '/test',
        jobId: 'job-1',
        details: {
          commitSha: 'def456',
          summary: 'Committed 2 file(s) for job-1.'
        }
      }
    ],
    soloEvents: [
      {
        version: 1,
        id: 'audit-1',
        timestamp: '2026-06-12T00:00:00.000Z',
        action: 'solo.commit',
        actor: { id: 'ai-system-cli', role: 'operator' },
        cwd: '/test',
        jobId: 'job-commit-test',
        details: {
          commitSha: 'abc123',
          summary: 'Committed 1 file(s) for job-commit-test.'
        }
      },
      {
        version: 1,
        id: 'audit-2',
        timestamp: '2026-06-12T01:00:00.000Z',
        action: 'solo.continue',
        actor: { id: 'ai-system-cli', role: 'operator' },
        cwd: '/test',
        jobId: 'job-continued',
        details: {
          sourceJobId: 'job-original',
          fixVerification: true,
          summary: 'Continue Orchestra Solo job job-original.'
        }
      },
      {
        version: 1,
        id: 'audit-3',
        timestamp: '2026-06-12T02:00:00.000Z',
        action: 'solo.commit',
        actor: { id: 'ai-system-cli', role: 'operator' },
        cwd: '/test',
        jobId: 'job-1',
        details: {
          commitSha: 'def456',
          summary: 'Committed 2 file(s) for job-1.'
        }
      }
    ],
    loading: false,
    error: null,
    totalSoloEvents: 2,
    soloActionCounts: { commit: 1, continue: 1, undo: 0 },
    fetchAudit: vi.fn()
  })
}));

describe('Dashboard Smoke Test', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the main dashboard layout and shows job data', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );
    
    // Check for main sections
    expect(screen.getByText(/Event Feed/i)).toBeDefined();
    expect(screen.getByText(/Total Workload/i)).toBeDefined();
    
    // Check for mocked job data
    expect(screen.getByText(/Test Task/i)).toBeDefined();
    
    // Check for footer info
    expect(screen.getByText(/Engine Active/i)).toBeDefined();
  });

  it('can navigate to config view', async () => {
    render(
      <MemoryRouter initialEntries={['/config']}>
        <App />
      </MemoryRouter>
    );
    
    const configHeader = await screen.findByText(/System Registry/i);
    expect(configHeader).toBeDefined();
  });

  it('can navigate to inbox view', async () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <App />
      </MemoryRouter>
    );
    
    const inboxHeader = await screen.findByText(/Import External Task/i);
    expect(inboxHeader).toBeDefined();
  });

  it('can navigate to analytics view', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <App />
      </MemoryRouter>
    );
    
    const analyticsHeader = await screen.findByText(/Analytics/i);
    expect(analyticsHeader).toBeDefined();
  });

  it('can navigate to work view', async () => {
    render(
      <MemoryRouter initialEntries={['/work']}>
        <App />
      </MemoryRouter>
    );
    
    const workHeader = await screen.findByText(/Work Board/i);
    expect(workHeader).toBeDefined();
  });

  it('shows the job audit trail inside job detail', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Task/i }));

    const auditTrailTab = await screen.findByRole('button', { name: /Audit Trail/i });
    fireEvent.click(auditTrailTab);

    expect(await screen.findByText(/Job Audit Trail/i)).toBeDefined();
    expect(screen.getAllByText(/Committed 2 file\(s\) for job-1\./i).length).toBeGreaterThan(0);
  });

  it('can navigate to the audit trail view', async () => {
    render(
      <MemoryRouter initialEntries={['/audit']}>
        <App />
      </MemoryRouter>
    );

    const auditHeaders = await screen.findAllByText(/Solo Audit Trail/i);
    expect(auditHeaders.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Committed 1 file\(s\) for job-commit-test\./i).length).toBeGreaterThan(0);
  });

  it('shows recent solo audit history on the home view', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText(/Solo Audit Trail/i)).toBeDefined();
    expect(screen.getByText(/job-continued/i)).toBeDefined();
    expect(screen.getByText(/Continue Orchestra Solo job job-original\./i)).toBeDefined();
  });

  it('ignores stale local storage project paths outside allowed workdirs', () => {
    localStorage.setItem('orchestra_ai_project', '/stale/workspace');

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByDisplayValue('/test')).toBeDefined();
  });
});
