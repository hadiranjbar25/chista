import Papa from 'papaparse';
export type Artifact = { id: string; name: string; format: string; raw: string; safe: string; redactions: number; selected: boolean };
const sensitive = /^(password|passwd|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|email|phone|ssn|name|full_name|address|ip|user_id)$/i;
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
    if (!value || /^\[[A-Z_]+_\d+\]$/.test(value)) return value;
    const existing = this.values.get(value); if (existing) return existing;
    const n = (this.counts.get(kind) ?? 0) + 1; this.counts.set(kind, n);
    const replacement = `[${this.namespace ? this.namespace + "_" : ""}${kind}_${n}]`; this.values.set(value, replacement); return replacement;
  }
  text(input: string, terms: string[] = []) {
    let text = input;
    for (const term of terms.filter(Boolean).sort((a,b) => b.length-a.length)) text = text.split(term).join(this.placeholder(term, 'CUSTOM'));
    text = text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, v => this.placeholder(v, 'SECRET'));
    text = text.replace(/\bBearer\s+([\w.\-+/=]+)/gi, (_, v: string) => `Bearer ${this.placeholder(v, 'SECRET')}`);
    text = text.replace(/\b(password|passwd|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|user_id|full_name|name|address|ssn|phone)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, (_, key: string, sep: string, v: string) => `${key}${sep}${this.placeholder(v.replace(/^["']|["']$/g, ''), 'SENSITIVE')}`);
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, v => this.placeholder(v, 'EMAIL'));
    text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, v => this.placeholder(v, 'IP'));
    text = text.replace(/\b(?:sk-[\w-]{8,}|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, v => this.placeholder(v, 'SECRET'));
    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, v => this.placeholder(v, 'SSN'));
    // Propagate values discovered in structured fields to free text in every artifact.
    for (const [value, replacement] of [...this.values].sort((a,b) => b[0].length-a[0].length)) {
      if (value.length >= 4) text = text.split(/(\[[A-Z_]+_\d+\])/g).map(part => /^\[[A-Z_]+_\d+\]$/.test(part) ? part : part.split(value).join(replacement)).join('');
    }
    return text;
  }
  sanitize(raw: string, format: string, terms: string[]) {
    const visit = (value: unknown, key = ''): unknown => {
      if (value === null) return value;
      if (Array.isArray(value)) return value.map(v => visit(v, key));
      if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [this.text(k, terms), visit(v, k)]));
      if (sensitive.test(key)) return this.placeholder(String(value), key.toLowerCase() === 'email' ? 'EMAIL' : 'SENSITIVE');
      return typeof value === 'string' ? this.text(value, terms) : value;
    };
    if (format === 'json') return JSON.stringify(visit(JSON.parse(raw)), null, 2);
    if (format === 'csv' || format === 'tsv') {
      const parsed = Papa.parse<string[]>(raw, { skipEmptyLines: true, ...(format === 'tsv' ? {delimiter:'\t'} : {}) });
      if (parsed.errors.length) throw new Error(`Malformed ${format.toUpperCase()}. Check quoting and delimiters.`);
      const [headers, ...rows] = parsed.data;
      if (!headers || rows.some(row => row.length !== headers.length)) throw new Error(`${format.toUpperCase()} rows must match the header columns.`);
      return Papa.unparse([headers.map(h => this.text(h, terms)), ...rows.map(row => row.map((v,i) => visit(v, headers[i]))) ], {delimiter:format === 'tsv' ? '\t' : ','});
    }
    return this.text(raw, terms);
  }
}
export function sanitizeArtifacts(files: Artifact[], sanitizer: Sanitizer, terms: string[]) {
  // Discovery pass ensures a later JSON/CSV field also redacts an earlier log.
  files.forEach(f => sanitizer.sanitize(f.raw, f.format, terms));
  return files.map(f => { const safe = sanitizer.sanitize(f.raw, f.format, terms); return { ...f, safe, redactions: (safe.match(/\[[A-Z_]+_\d+\]/g) ?? []).length }; });
}
export function compact(files: Artifact[], limit: number) {
  const selected = files.filter(f => f.selected);
  let remaining = limit;
  const artifacts = selected.map((f, index) => {
    const budget = Math.max(0, Math.floor(remaining / (selected.length-index)));
    const lines = f.safe.split('\n');
    const unique = [...new Set(lines)];
    const content = unique.join('\n').slice(0, budget); remaining -= content.length;
    return { artifact: `artifact-${index+1}.${f.format}`, content, omittedCharacters: Math.max(0, f.safe.length-content.length) };
  });
  return JSON.stringify({ version: 1, mode: 'sanitized-context', note: 'Sanitized excerpts; may be truncated. Review before sharing.', artifacts }, null, 2);
}
