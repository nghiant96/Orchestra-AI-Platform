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
    // This is more of an integration test, but good for smoke
    render(
      <MemoryRouter initialEntries={['/config']}>
        <App />
      </MemoryRouter>
    );
    
    const configHeader = await screen.findByText(/System Registry/i);
    expect(configHeader).toBeDefined();
  });
});
