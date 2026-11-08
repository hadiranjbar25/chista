import { z } from 'zod/v4';
import { Sanitizer, compact, type Artifact } from './safety';
import type { EvidenceSource } from './investigation';

export const savedSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('investigation'),
      version: z.literal(1),
      context: z.string().max(1_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('redaction-profile'),
      version: z.literal(1),
      terms: z.array(z.string().min(1).max(2000)).max(200),
    })
    .strict(),
]);
export type SavedInvestigation = z.infer<typeof savedSchema>;
const envelopeSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal('AES-GCM/PBKDF2-SHA256'),
    iterations: z.literal(600_000),
    salt: z.string().max(24),
    iv: z.string().max(16),
    ciphertext: z.string().max(1_500_000),
  })
  .strict();
const encode = (bytes: Uint8Array) => {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (password.length < 12 || password.length > 1000)
    throw new Error('Use a passphrase of 12–1000 characters.');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
const aad = new TextEncoder().encode('Chista encrypted investigation v1');
export async function sealInvestigation(value: SavedInvestigation, password: string) {
  const valid = savedSchema.parse(value);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    await key(password, salt),
    new TextEncoder().encode(JSON.stringify(valid)),
  );
  return JSON.stringify({
    version: 1,
    algorithm: 'AES-GCM/PBKDF2-SHA256',
    iterations: 600_000,
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  });
}
export async function openInvestigation(
  text: string,
  password: string,
): Promise<SavedInvestigation> {
  if (text.length > 1_600_000) throw new Error('Encrypted file exceeds the import limit.');
  try {
    const envelope = envelopeSchema.parse(JSON.parse(text));
    const salt = decode(envelope.salt),
      iv = decode(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encryption parameters.');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      await key(password, salt),
      decode(envelope.ciphertext),
    );
    return savedSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw new Error('Could not unlock file. Check the passphrase and file integrity.');
  }
}
// Whitelist the outbound fields. No originals, filenames, paths, mappings or custom terms.
export function investigationBundle(
  files: Artifact[],
  sources: EvidenceSource[],
  sanitizer: Sanitizer,
  audit: unknown[] = [],
  conversations: import('../integrations/providers').Message[][] = [],
) {
  const context = JSON.parse(compact(files, 100_000));
  const evidence = sources.slice(-20).map((source, index) => ({
    source: `tool-evidence-${index + 1}`,
    content: sanitizer.text(source.content).slice(0, 10_000),
    truncated: source.truncated || source.content.length > 10_000,
  }));
  let remaining = 80_000;
  const chats = conversations.slice(-10).map((messages, index) => ({
    session: `session-${index + 1}`,
    omittedMessages: Math.max(0, messages.length - 40),
    messages: messages.slice(-40).map((message) => {
      const content = sanitizer.text(message.content).slice(0, Math.min(6000, remaining));
      remaining -= content.length;
      return { role: message.role, content, truncated: message.content.length > content.length };
    }),
  }));
  return JSON.stringify(
    { chats, version: 1, mode: 'sanitized-investigation', context, evidence, audit },
    null,
    2,
  );
}
export function downloadFile(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
