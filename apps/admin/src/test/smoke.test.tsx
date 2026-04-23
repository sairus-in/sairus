import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('smoke', () => {
  it('renders a basic element', async () => {
    render(<div>smoke ok</div>);

    expect(await screen.findByText('smoke ok')).toBeInTheDocument();
  });
});
