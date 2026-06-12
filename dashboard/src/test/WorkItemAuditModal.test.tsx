import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkItemDetailModal } from '../components/work-item-detail/WorkItemDetailModal';
import type { WorkItem, AuditEvent } from '../types';

vi.mock('../utils/api', () => ({
  apiJson: vi.fn(async (input: string) => {
    if (input.includes('/events')) {
      return {
        ok: true,
        events: [{
          id: 'work-audit-1',
          version: 1,
          timestamp: '2026-06-12T02:00:00.000Z',
          action: 'solo.continue',
          actor: { id: 'ai-system-cli', role: 'operator' },
          cwd: '/test',
          jobId: 'job-linked',
          details: {
            sourceJobId: 'job-linked',
            fixVerification: true,
            summary: 'Continue Orchestra Solo job job-linked.'
          }
        } satisfies AuditEvent]
      };
    }

    return {
      ok: true,
      workItem: {
        schemaVersion: 1,
        id: 'wi-1',
        projectId: 'project-1',
        title: 'Audit scope test',
        description: 'Audit modal smoke test',
        status: 'created',
        risk: 'low',
        expectedOutput: 'report',
        source: 'manual',
        type: 'feature',
        linkedRuns: ['job-linked'],
        linkedJobs: [],
        createdBy: 'tester',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
        events: [],
      }
    };
  })
}));

vi.mock('../components/work-item-detail/AssessmentTab', () => ({ AssessmentTab: () => <div>Assessment Mock</div> }));
vi.mock('../components/work-item-detail/GraphTab', () => ({ GraphTab: () => <div>Graph Mock</div> }));
vi.mock('../components/work-item-detail/ChecklistTab', () => ({ ChecklistTab: () => <div>Checklist Mock</div> }));
vi.mock('../components/work-item-detail/RunsTab', () => ({ RunsTab: () => <div>Runs Mock</div> }));
vi.mock('../components/work-item-detail/BranchTab', () => ({ BranchTab: () => <div>Branch Mock</div> }));
vi.mock('../components/work-item-detail/ChecksTab', () => ({ ChecksTab: () => <div>Checks Mock</div> }));
vi.mock('../components/work-item-detail/ActionsTab', () => ({ ActionsTab: () => <div>Actions Mock</div> }));
vi.mock('../components/work-item-detail/EventsTab', () => ({ EventsTab: () => <div>Events Mock</div> }));

const baseWorkItem: WorkItem = {
  schemaVersion: 1,
  id: 'wi-1',
  projectId: 'project-1',
  title: 'Audit scope test',
  description: 'Audit modal smoke test',
  status: 'created',
  risk: 'low',
  expectedOutput: 'report',
  source: 'manual',
  type: 'feature',
  linkedRuns: ['job-linked'],
  linkedJobs: [],
  createdBy: 'tester',
  createdAt: '2026-06-12T00:00:00.000Z',
  updatedAt: '2026-06-12T00:00:00.000Z',
  events: [],
};

describe('Work item audit modal', () => {
  it('shows the linked audit trail in a dedicated tab', async () => {
    render(
      <WorkItemDetailModal
        workItem={baseWorkItem}
        cwd="/test"
        auditEvents={[
          {
            id: 'audit-1',
            version: 1,
            timestamp: '2026-06-12T02:00:00.000Z',
            action: 'solo.continue',
            actor: { id: 'ai-system-cli', role: 'operator' },
            cwd: '/test',
            jobId: 'job-linked',
            details: {
              sourceJobId: 'job-linked',
              fixVerification: true,
              summary: 'Continue Orchestra Solo job job-linked.'
            }
          }
        ]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Audit Trail/i }));

    expect(await screen.findByText(/Work Item Audit Trail/i)).toBeDefined();
    expect(screen.getAllByText(/Continue Orchestra Solo job job-linked\./i).length).toBeGreaterThan(0);
  });
});
