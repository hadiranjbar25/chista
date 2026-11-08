// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InvestigationLibrary from './InvestigationLibrary';
import { Sanitizer } from './safety';
import type { EvidenceController } from './useEvidenceSession';
afterEach(cleanup);
it('requires a review of sanitized bytes and revokes the preview when evidence changes', async () => {
  const user = userEvent.setup();
  const sanitizer = new Sanitizer();
  const raw = '{"email":"private@example.com"}';
  const file = {
    id: 'private-id',
    name: 'private-name.json',
    raw,
    safe: sanitizer.sanitize(raw, 'json', []),
    format: 'json',
    redactions: 1,
    selected: true,
  };
  const evidence = {
    files: [file],
    terms: '',
    sanitizer: { current: sanitizer },
  } as EvidenceController;
  const sources: [] = [];
  const view = render(<InvestigationLibrary evidence={evidence} sources={sources} />);
  await user.click(screen.getByRole('button', { name: 'Preview sanitized share bundle' }));
  const dialog = screen.getByRole('dialog', { name: 'Review investigation bundle' });
  expect(dialog.textContent).not.toContain('private@example.com');
  expect(dialog.textContent).not.toContain('private-name');
  const exported = screen.getByRole('button', {
    name: 'Export sanitized bundle',
  }) as HTMLButtonElement;
  expect(exported.disabled).toBe(true);
  await user.click(screen.getByRole('checkbox'));
  expect(exported.disabled).toBe(false);
  view.rerender(
    <InvestigationLibrary
      evidence={{ ...evidence, files: [{ ...file, selected: false }] }}
      sources={sources}
    />,
  );
  expect(screen.queryByRole('dialog', { name: 'Review investigation bundle' })).toBeNull();
});
