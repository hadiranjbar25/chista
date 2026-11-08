import { expect, it } from 'vitest';
import { sealInvestigation, openInvestigation, investigationBundle } from './investigationVault';
import { Sanitizer } from './safety';
it('encrypts profiles with fresh randomness and detects wrong passwords and tampering', async () => {
  const profile = {
    kind: 'redaction-profile' as const,
    version: 1 as const,
    terms: ['private customer'],
  };
  const a = await sealInvestigation(profile, 'correct long password');
  const b = await sealInvestigation(profile, 'correct long password');
  expect(a).not.toEqual(b);
  expect(a).not.toContain('private customer');
  expect(await openInvestigation(a, 'correct long password')).toEqual(profile);
  await expect(openInvestigation(a, 'wrong long password')).rejects.toThrow('Could not unlock');
  const tampered = JSON.parse(a);
  tampered.ciphertext = 'AAAA' + tampered.ciphertext.slice(4);
  await expect(
    openInvestigation(JSON.stringify(tampered), 'correct long password'),
  ).rejects.toThrow('Could not unlock');
  await expect(openInvestigation('{"version":999}', 'correct long password')).rejects.toThrow(
    'Could not unlock',
  );
});
it('exports a field whitelist without raw originals, names or reversal mappings', () => {
  const sanitizer = new Sanitizer();
  const secret = 'private@example.com';
  const safe = sanitizer.sanitize(JSON.stringify({ email: secret }), 'json', []);
  const bundle = investigationBundle(
    [
      {
        id: 'local-id',
        name: 'private-filename.json',
        format: 'json',
        raw: secret,
        safe,
        redactions: 1,
        selected: true,
      },
    ],
    [],
    sanitizer,
  );
  expect(bundle).not.toContain(secret);
  expect(bundle).not.toContain('private-filename');
  expect(bundle).not.toContain('local-id');
  expect(bundle).toContain('[EMAIL_1]');
});
it('supports encrypted investigation round trips and rejects weak passwords', async () => {
  const value = {
    kind: 'investigation' as const,
    version: 1 as const,
    context: '{"evidence":"safe"}',
  };
  expect(
    await openInvestigation(
      await sealInvestigation(value, 'long investigation password'),
      'long investigation password',
    ),
  ).toEqual(value);
  await expect(sealInvestigation(value, 'short')).rejects.toThrow('passphrase');
});
