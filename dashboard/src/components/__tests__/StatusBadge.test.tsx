import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';
import { describe, it, expect } from 'vitest';

describe('StatusBadge', () => {
  it('renders completed status correctly', () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });

  it('renders running status correctly', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('renders failed status correctly', () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
