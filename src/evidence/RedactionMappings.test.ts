import { describe, expect, it } from 'vitest';
import { activeMappings } from './RedactionMappings';
import { compact, Sanitizer, sanitizeArtifacts, type Artifact } from './safety';
const file = (raw: string): Artifact => ({
  id: crypto.randomUUID(),
  name: crypto.randomUUID() + '.log',
  format: 'log',
  raw,
  safe: '',
  redactions: 0,
  selected: true,
});
describe('local mapping inventory', () => {
  it('returns detached mapping snapshots and consistent cross-artifact counts', () => {
    const sanitizer = new Sanitizer();
    const files = sanitizeArtifacts(
      [file('a@example.com a@example.com'), file('a@example.com')],
      sanitizer,
      [],
    );
    const rows = activeMappings(sanitizer.mappings(), files);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      original: 'a@example.com',
      placeholder: '[EMAIL_1]',
      occurrences: 3,
    });
    expect(rows[0].artifacts).toHaveLength(2);
    const snapshot = sanitizer.mappings();
    snapshot[0].original = 'mutated';
    expect(sanitizer.mappings()[0].original).toBe('a@example.com');
    expect(compact(files, 6000)).not.toContain('a@example.com');
    expect(activeMappings(sanitizer.mappings(), [])).toEqual([]);
  });
  it('does not confuse placeholder prefixes and excludes removed artifact mappings', () => {
    const sanitizer = new Sanitizer();
    const files = sanitizeArtifacts(
      Array.from({ length: 10 }, (_, i) => file(`user${i}@example.com`)),
      sanitizer,
      [],
    );
    const rows = activeMappings(sanitizer.mappings(), [files[9]]);
    expect(rows).toHaveLength(1);
    expect(rows[0].placeholder).toBe('[EMAIL_10]');
    expect(rows[0].occurrences).toBe(1);
    expect(new Sanitizer().mappings()).toEqual([]);
  });
  it('includes custom values in the local mapping and only their placeholders in context', () => {
    const sanitizer = new Sanitizer();
    const files = sanitizeArtifacts([file('tenant-private')], sanitizer, ['tenant-private']);
    expect(activeMappings(sanitizer.mappings(), files)[0]).toMatchObject({
      original: 'tenant-private',
      placeholder: '[CUSTOM_1]',
    });
    expect(compact(files, 6000)).not.toContain('tenant-private');
  });
});
