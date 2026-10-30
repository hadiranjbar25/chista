import { describe, it, expect } from 'vitest';
import { compact, Sanitizer, sanitizeArtifacts, type Artifact } from './safety';
const file = (raw: string, format = 'log'): Artifact => ({
  id: crypto.randomUUID(),
  name: 'private@example.com.' + format,
  raw,
  format,
  safe: '',
  selected: true,
  redactions: 0,
});
describe('local safety pipeline', () => {
  it('restores exact masks locally without changing mappings or sanitized exports', () => {
    const sanitizer = new Sanitizer('WORKSPACE');
    const raw = JSON.stringify({
      name: 'chista',
      id: 'repo-123',
      password: 'secret-value',
      email: 'alex@example.com',
    });
    const safe = sanitizer.sanitize(raw, 'json', ['custom-value']);
    const mappings = sanitizer.mappings();
    for (const { original, placeholder } of mappings)
      expect(sanitizer.restore(`Value: ${placeholder}; ${placeholder}`)).toBe(
        `Value: ${original}; ${original}`,
      );
    expect(sanitizer.restore('[UNKNOWN_1] [WORKSPACE_EMAIL_10] [WORKSPACE_EMAIL_')).toBe(
      '[UNKNOWN_1] [WORKSPACE_EMAIL_10] [WORKSPACE_EMAIL_',
    );
    expect(sanitizer.restore('[WORKSPACE_EMAIL_1]')).toBe('alex@example.com');
    expect(sanitizer.mappings()).toEqual(mappings);
    expect(sanitizer.sanitize(raw, 'json', ['custom-value'])).toBe(safe);
    expect(sanitizer.text('custom-value', ['custom-value'])).toBe('[WORKSPACE_CUSTOM_1]');
    expect(sanitizer.restore('[WORKSPACE_CUSTOM_1]')).toBe('custom-value');
    expect(sanitizer.text('Repository name: [WORKSPACE_SENSITIVE_1].')).toContain(
      '[WORKSPACE_SENSITIVE_1].',
    );
  });

  it('restores in one pass even when an original value contains another mask', () => {
    const sanitizer = new Sanitizer();
    sanitizer.placeholder('a "quoted" value\n[EMAIL_1]', 'SENSITIVE');
    sanitizer.placeholder('alex@example.com', 'EMAIL');
    expect(sanitizer.restore('[SENSITIVE_1]')).toBe('a "quoted" value\n[EMAIL_1]');
  });

  it('masks identifier fields at every JSON depth, including numeric IDs and arrays', () => {
    const sanitizer = new Sanitizer();
    const safe = JSON.parse(
      sanitizer.sanitize(
        JSON.stringify({
          id: 'record-123',
          ID: 7,
          request_id: 'request-456',
          ACCOUNT_ID: ['account-789', 'record-123'],
          nested: [{ session_id: 'session-012', id: null }],
          valid: true,
          grid: 'layout',
          identity: 'unchanged',
        }),
        'json',
        [],
      ),
    );
    expect(safe.id).toMatch(/^\[SENSITIVE_\d+\]$/);
    expect(safe.ID).toMatch(/^\[SENSITIVE_\d+\]$/);
    expect(safe.request_id).toMatch(/^\[SENSITIVE_\d+\]$/);
    expect(safe.ACCOUNT_ID[0]).toMatch(/^\[SENSITIVE_\d+\]$/);
    expect(safe.ACCOUNT_ID[1]).toBe(safe.id);
    expect(safe.nested[0].session_id).toMatch(/^\[SENSITIVE_\d+\]$/);
    expect(safe.nested[0].id).toBeNull();
    expect(safe.valid).toBe(true);
    expect(safe.grid).toBe('layout');
    expect(safe.identity).toBe('unchanged');
  });

  it.each(['csv', 'tsv'])(
    'masks identifier columns in %s and shares mappings with logs',
    (format) => {
      const delimiter = format === 'csv' ? ',' : '\t';
      const rows = [
        ['id', 'ID', 'trace_id', 'status'],
        ['record-123', '7', 'trace-456', '200'],
      ]
        .map((row) => row.join(delimiter))
        .join('\n');
      const sanitizer = new Sanitizer();
      const result = sanitizeArtifacts(
        [file('Observed record-123 and trace-456'), file(rows, format)],
        sanitizer,
        [],
      );
      expect(result[1].safe).toContain(['id', 'ID', 'trace_id', 'status'].join(delimiter));
      expect(result[1].safe).toContain('200');
      for (const artifact of result) {
        expect(artifact.safe).not.toContain('record-123');
        expect(artifact.safe).not.toContain('trace-456');
      }
      expect(sanitizer.mappings().find((mapping) => mapping.original === '7')).toBeTruthy();
    },
  );

  it('masks identifier assignments and quoted JSON in free text without breaking JSON', () => {
    const sanitizer = new Sanitizer();
    const safe = sanitizer.text(
      'id=7 ID:record-123 request_id="request 456" _id=internal-789 valid=true grid=layout',
    );
    expect(safe).toContain('id=[SENSITIVE_');
    expect(safe).not.toContain('record-123');
    expect(safe).not.toContain('request 456');
    expect(safe).not.toContain('internal-789');
    expect(safe).toContain('valid=true grid=layout');
    expect(sanitizer.text(safe)).toBe(safe);
    expect(sanitizer.text('id="invalid\\escape"')).not.toContain('invalid');
    const json = sanitizer.text('{"id":7,"tenant_id":"tenant-456","ID":null,"status":200}');
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe(
      sanitizer.mappings().find((mapping) => mapping.original === '7')!.placeholder,
    );
    expect(parsed.tenant_id).toMatch(/^\[SENSITIVE_\d+\]$/);
    expect(parsed.ID).toBeNull();
    expect(parsed.status).toBe(200);
    expect(sanitizer.text(json)).toBe(json);
  });

  it('uses the same placeholders across formats and discovers later fields', () => {
    const result = sanitizeArtifacts(
      [
        file('Alex Person alex@example.com token=abcdsecret'),
        file('{"name":"Alex Person","email":"alex@example.com","api_key":"abcdsecret"}', 'json'),
        file('email,name\nalex@example.com,Alex Person', 'csv'),
      ],
      new Sanitizer(),
      [],
    );
    for (const f of result) {
      expect(f.safe).not.toContain('alex@example.com');
      expect(f.safe).not.toContain('Alex Person');
      expect(f.safe).not.toContain('abcdsecret');
      expect(f.safe).toContain('[EMAIL_1]');
    }
    expect(() => JSON.parse(result[1].safe)).not.toThrow();
  });
  it('sanitizes bearer tokens, IPs, SSNs and custom values', () => {
    const s = new Sanitizer().text('Bearer abc.def.xyz 192.168.0.1 123-45-6789 internal.host', [
      'internal.host',
    ]);
    for (const secret of ['abc.def.xyz', '192.168.0.1', '123-45-6789', 'internal.host'])
      expect(s).not.toContain(secret);
  });
  it('handles quoted CSV fields and rejects malformed data', () => {
    const s = new Sanitizer();
    expect(s.sanitize('name,email\n"Doe, Jane",jane@example.com', 'csv', [])).not.toContain('Jane');
    expect(() => s.sanitize('a,b\n1,2,3', 'csv', [])).toThrow();
    expect(() => s.sanitize('{broken', 'json', [])).toThrow();
  });
  it('exports only selected sanitized content with generic names and a strict content budget', () => {
    const files = sanitizeArtifacts(
      [file('email=a@example.com\n'.repeat(20)), { ...file('DO_NOT_EXPORT'), selected: false }],
      new Sanitizer(),
      [],
    );
    const result = compact(files, 20);
    expect(result).not.toContain('a@example.com');
    expect(result).not.toContain('private@example.com');
    expect(result).not.toContain('DO_NOT_EXPORT');
    expect(JSON.parse(result).artifacts[0].content.length).toBeLessThanOrEqual(20);
  });
  it('keeps placeholders stable on repeated sanitization', () => {
    const s = new Sanitizer();
    const first = sanitizeArtifacts([file('a@example.com')], s, []);
    expect(sanitizeArtifacts(first, s, [])[0].safe).toBe(first[0].safe);
  });
});

it('sanitizes TSV fields consistently and preserves tabs, commas, and quoted multiline cells', () => {
  const raw = 'email\tname\tnote\nalex@example.com\tAlex Person\t"first, item\tsecond\nnext line"';
  const files = sanitizeArtifacts(
    [file('Alex Person alex@example.com'), file(raw, 'tsv')],
    new Sanitizer(),
    [],
  );
  expect(files[1].safe).toContain('email\tname\tnote');
  expect(files[1].safe).toContain('"first, item\tsecond\nnext line"');
  for (const entry of files) {
    expect(entry.safe).not.toContain('Alex Person');
    expect(entry.safe).not.toContain('alex@example.com');
    expect(entry.safe).toContain('[EMAIL_1]');
  }
  expect(compact(files, 6000)).toContain('tsv');
  expect(() => new Sanitizer().sanitize('a\tb\n1\t2\t3', 'tsv', [])).toThrow('TSV rows');
  expect(() => new Sanitizer().sanitize('a\tb\n"unterminated\t2', 'tsv', [])).toThrow(
    'Malformed TSV',
  );
});
it('preserves explicit authorization decisions while masking authorization credentials', () => {
  const sanitizer = new Sanitizer();
  const safe = sanitizer.sanitize(
    JSON.stringify({
      events: [{ authorization: 'allowed' }, { authorization: 'required_group_missing' }],
      headers: { authorization: 'Bearer private-token' },
      other: { authorization: 'Basic dXNlcjpwYXNzd29yZA==' },
    }),
    'json',
    [],
  );
  expect(safe).toContain('allowed');
  expect(safe).toContain('required_group_missing');
  expect(safe).not.toContain('private-token');
  expect(safe).not.toContain('dXNlcjpwYXNzd29yZA==');
  expect(sanitizer.text('status=200 authorization=allowed')).toContain('authorization=allowed');
  expect(sanitizer.text('status=403 authorization=denied')).toContain('authorization=denied');
  expect(sanitizer.text('authorization=arbitrary-secret')).not.toContain('arbitrary-secret');
  expect(sanitizer.text('42 allowed responses')).toBe('42 allowed responses');
});
