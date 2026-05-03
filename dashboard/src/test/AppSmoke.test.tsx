import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('Dashboard Smoke Test', () => {
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
});
