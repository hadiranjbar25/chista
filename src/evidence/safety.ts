import {
  SENSITIVE_FIELD,
  IDENTIFIER_FIELD,
  AUTHORIZATION_DECISION,
  PRIVATE_KEY,
  BEARER_TOKEN,
  SENSITIVE_ASSIGNMENT,
  IDENTIFIER_ASSIGNMENT,
  EMAIL_ADDRESS,
  IP_ADDRESS,
  API_CREDENTIAL,
  SOCIAL_SECURITY_NUMBER,
  PLACEHOLDER,
  PLACEHOLDER_SEGMENTS,
  PLACEHOLDER_OCCURRENCES,
} from './sanitizerRules';
import Papa from 'papaparse';
export type Artifact = {
  id: string;
  name: string;
  format: string;
  raw: string;
  safe: string;
  redactions: number;
  selected: boolean;
};
export type RedactionMapping = { original: string; placeholder: string };
export class Sanitizer {
  constructor(private namespace = '') {}
  private values = new Map<string, string>();
  private counts = new Map<string, number>();
  // Copies for local inspection only. Never include these entries in an outbound payload.
  mappings(): RedactionMapping[] {
    return [...this.values].map(([original, placeholder]) => ({ original, placeholder }));
  }
  placeholder(value: string, kind: string) {
    if (!value || PLACEHOLDER.test(value)) return value;
    const existing = this.values.get(value);
    if (existing) return existing;
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    const replacement = `[${this.namespace ? this.namespace + '_' : ''}${kind}_${n}]`;
    this.values.set(value, replacement);
    return replacement;
  }
  text(input: string, terms: string[] = []) {
    let text = input;
    for (const term of terms.filter(Boolean).sort((a, b) => b.length - a.length))
      text = text.split(term).join(this.placeholder(term, 'CUSTOM'));
    text = text.replace(PRIVATE_KEY, (v) => this.placeholder(v, 'SECRET'));
    text = text.replace(BEARER_TOKEN, (_, v: string) => `Bearer ${this.placeholder(v, 'SECRET')}`);
    text = text.replace(SENSITIVE_ASSIGNMENT, (_, key: string, sep: string, v: string) =>
      key.toLowerCase() === 'authorization' &&
      AUTHORIZATION_DECISION.test(v.replace(/^["']|["']$/g, ''))
        ? `${key}${sep}${v}`
        : `${key}${sep}${this.placeholder(v.replace(/^["']|["']$/g, ''), 'SENSITIVE')}`,
    );
    // Support log assignments and quoted JSON fields in messages or tool text.
    // Preserve quotes and delimiters so embedded JSON remains parseable.
    text = text.replace(
      IDENTIFIER_ASSIGNMENT,
      (_, prefix: string, keyQuote: string, key: string, separator: string, raw: string) => {
        if (raw === 'null') return `${prefix}${keyQuote}${key}${keyQuote}${separator}${raw}`;
        const valueQuote = raw[0] === '"' || raw[0] === "'" ? raw[0] : '';
        let value = valueQuote ? raw.slice(1, -1) : raw;
        if (valueQuote === '"') {
          try {
            value = JSON.parse(raw) as string;
          } catch {
            // Quoted log values can contain escapes that are not valid JSON.
          }
        }
        const replacement = this.placeholder(value, 'SENSITIVE');
        const encoded =
          keyQuote === '"' || valueQuote === '"'
            ? JSON.stringify(replacement)
            : valueQuote
              ? `'${replacement}'`
              : replacement;
        return `${prefix}${keyQuote}${key}${keyQuote}${separator}${encoded}`;
      },
    );
    text = text.replace(EMAIL_ADDRESS, (v) => this.placeholder(v, 'EMAIL'));
    text = text.replace(IP_ADDRESS, (v) => this.placeholder(v, 'IP'));
    text = text.replace(API_CREDENTIAL, (v) => this.placeholder(v, 'SECRET'));
    text = text.replace(SOCIAL_SECURITY_NUMBER, (v) => this.placeholder(v, 'SSN'));
    // Propagate values discovered in structured fields to free text in every artifact.
    for (const [value, replacement] of [...this.values].sort((a, b) => b[0].length - a[0].length)) {
      if (value.length >= 4)
        text = text
          .split(PLACEHOLDER_SEGMENTS)
          .map((part) => (PLACEHOLDER.test(part) ? part : part.split(value).join(replacement)))
          .join('');
    }
    return text;
  }
  sanitize(raw: string, format: string, terms: string[]) {
    const visit = (value: unknown, key = ''): unknown => {
      if (value === null) return value;
      if (Array.isArray(value)) return value.map((v) => visit(v, key));
      if (typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [this.text(k, terms), visit(v, k)]),
        );
      if (
        key.toLowerCase() === 'authorization' &&
        typeof value === 'string' &&
        AUTHORIZATION_DECISION.test(value)
      )
        return this.text(value, terms);
      if (SENSITIVE_FIELD.test(key) || IDENTIFIER_FIELD.test(key.trim()))
        return this.placeholder(
          String(value),
          key.toLowerCase() === 'email' ? 'EMAIL' : 'SENSITIVE',
        );
      return typeof value === 'string' ? this.text(value, terms) : value;
    };
    if (format === 'json') return JSON.stringify(visit(JSON.parse(raw)), null, 2);
    if (format === 'csv' || format === 'tsv') {
      const parsed = Papa.parse<string[]>(raw, {
        skipEmptyLines: true,
        ...(format === 'tsv' ? { delimiter: '\t' } : {}),
      });
      if (parsed.errors.length)
        throw new Error(`Malformed ${format.toUpperCase()}. Check quoting and delimiters.`);
      const [headers, ...rows] = parsed.data;
      if (!headers || rows.some((row) => row.length !== headers.length))
        throw new Error(`${format.toUpperCase()} rows must match the header columns.`);
      return Papa.unparse(
        [
          headers.map((h) => this.text(h, terms)),
          ...rows.map((row) => row.map((v, i) => visit(v, headers[i]))),
        ],
        { delimiter: format === 'tsv' ? '\t' : ',' },
      );
    }
    return this.text(raw, terms);
  }
}
export function sanitizeArtifacts(files: Artifact[], sanitizer: Sanitizer, terms: string[]) {
  // Discovery pass ensures a later JSON/CSV field also redacts an earlier log.
  files.forEach((f) => sanitizer.sanitize(f.raw, f.format, terms));
  return files.map((f) => {
    const safe = sanitizer.sanitize(f.raw, f.format, terms);
    return { ...f, safe, redactions: (safe.match(PLACEHOLDER_OCCURRENCES) ?? []).length };
  });
}
export function compact(files: Artifact[], limit: number) {
  const selected = files.filter((f) => f.selected);
  let remaining = limit;
  const artifacts = selected.map((f, index) => {
    const budget = Math.max(0, Math.floor(remaining / (selected.length - index)));
    const lines = f.safe.split('\n');
    const unique = [...new Set(lines)];
    const content = unique.join('\n').slice(0, budget);
    remaining -= content.length;
    return {
      artifact: `artifact-${index + 1}.${f.format}`,
      content,
      omittedCharacters: Math.max(0, f.safe.length - content.length),
    };
  });
  return JSON.stringify(
    {
      version: 1,
      mode: 'sanitized-context',
      note: 'Sanitized excerpts; may be truncated. Review before sharing.',
      artifacts,
    },
    null,
    2,
  );
}
