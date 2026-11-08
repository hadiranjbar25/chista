// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AgentResponse from './AgentResponse';
import { parseReply } from './response';
import { Sanitizer } from '../evidence/safety';
afterEach(cleanup);
it('rejects unregistered components, invalid inputs and executable UI', () => {
  for (const block of [
    { type: 'html', content: '<script>alert(1)</script>' },
    { type: 'chart', title: 'unsafe', items: [{ label: 'NaN', value: -1 }] },
    { type: 'form', title: 'unsafe', fields: [{ id: '__proto__', label: 'x', type: 'text' }] },
    { type: 'json', title: 'unsafe', content: '{broken' },
  ])
    expect(parseReply(JSON.stringify({ text: 'Fallback', blocks: [block] })).blocks).toEqual([]);
  const follow = vi.fn();
  render(
    <AgentResponse
      content={'<img src=x onerror="alert(1)"><script>alert(1)</script>'}
      onFollow={follow}
    />,
  );
  expect(screen.getByText(/<img src=x/)).toBeTruthy();
  expect(document.querySelector('script, img')).toBeNull();
  expect(follow).not.toHaveBeenCalled();
});
it('redacts telemetry secrets before context and preserves public authorization outcomes', () => {
  const sanitizer = new Sanitizer();
  const safe = sanitizer.sanitize(
    JSON.stringify({
      email: 'person@example.com',
      authorization: 'denied',
      request: { headers: { Authorization: 'Bearer opaque-credential' } },
      attributes: [{ key: 'auth.token', value: { stringValue: 'opaque-telemetry-secret' } }],
    }),
    'json',
    [],
  );
  expect(safe).not.toContain('person@example.com');
  expect(safe).not.toContain('opaque-credential');
  expect(safe).not.toContain('opaque-telemetry-secret');
  expect(safe).toContain('denied');
});
it('redacts quoted secrets in free-text prompts and URL userinfo', () => {
  const sanitizer = new Sanitizer();
  const safe = sanitizer.text(
    'Investigate {"token":"opaque-json-secret", "authorization":"denied"} and https://user:password@example.com/path',
  );
  expect(safe).not.toContain('opaque-json-secret');
  expect(safe).not.toContain('user:password');
  expect(safe).toContain('"denied"');
});
