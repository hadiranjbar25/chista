import { describe, it, expect } from 'vitest';
import { compact, Sanitizer, sanitizeArtifacts, type Artifact } from './safety';
const file = (raw: string, format = 'log'): Artifact => ({id:crypto.randomUUID(),name:'private@example.com.'+format,raw,format,safe:'',selected:true,redactions:0});
describe('local safety pipeline', () => {
 it('uses the same placeholders across formats and discovers later fields', () => {
  const result = sanitizeArtifacts([file('Alex Person alex@example.com token=abcdsecret'), file('{"name":"Alex Person","email":"alex@example.com","api_key":"abcdsecret"}','json'), file('email,name\nalex@example.com,Alex Person','csv')],new Sanitizer(),[]);
  for(const f of result) { expect(f.safe).not.toContain('alex@example.com'); expect(f.safe).not.toContain('Alex Person'); expect(f.safe).not.toContain('abcdsecret'); expect(f.safe).toContain('[EMAIL_1]'); }
  expect(() => JSON.parse(result[1].safe)).not.toThrow();
 });
 it('sanitizes bearer tokens, IPs, SSNs and custom values', () => {const s = new Sanitizer().text('Bearer abc.def.xyz 192.168.0.1 123-45-6789 internal.host',['internal.host']);for(const secret of ['abc.def.xyz','192.168.0.1','123-45-6789','internal.host'])expect(s).not.toContain(secret);});
 it('handles quoted CSV fields and rejects malformed data', () => {const s=new Sanitizer();expect(s.sanitize('name,email\n"Doe, Jane",jane@example.com','csv',[])).not.toContain('Jane');expect(() => s.sanitize('a,b\n1,2,3','csv',[])).toThrow();expect(() => s.sanitize('{broken','json',[])).toThrow();});
 it('exports only selected sanitized content with generic names and a strict content budget', () => {const files=sanitizeArtifacts([file('email=a@example.com\n'.repeat(20)),{...file('DO_NOT_EXPORT'),selected:false}],new Sanitizer(),[]);const result=compact(files,20);expect(result).not.toContain('a@example.com');expect(result).not.toContain('private@example.com');expect(result).not.toContain('DO_NOT_EXPORT');expect(JSON.parse(result).artifacts[0].content.length).toBeLessThanOrEqual(20);});
 it('keeps placeholders stable on repeated sanitization', () => {const s=new Sanitizer();const first=sanitizeArtifacts([file('a@example.com')],s,[]);expect(sanitizeArtifacts(first,s,[])[0].safe).toBe(first[0].safe);});
});

it('sanitizes TSV fields consistently and preserves tabs, commas, and quoted multiline cells', () => {
  const raw='email\tname\tnote\nalex@example.com\tAlex Person\t"first, item\tsecond\nnext line"';
  const files=sanitizeArtifacts([file('Alex Person alex@example.com'),file(raw,'tsv')],new Sanitizer(),[]);
  expect(files[1].safe).toContain('email\tname\tnote');
  expect(files[1].safe).toContain('"first, item\tsecond\nnext line"');
  for(const entry of files){expect(entry.safe).not.toContain('Alex Person');expect(entry.safe).not.toContain('alex@example.com');expect(entry.safe).toContain('[EMAIL_1]');}
  expect(compact(files,6000)).toContain('tsv');
  expect(()=>new Sanitizer().sanitize('a\tb\n1\t2\t3','tsv',[])).toThrow('TSV rows');
  expect(()=>new Sanitizer().sanitize('a\tb\n"unterminated\t2','tsv',[])).toThrow('Malformed TSV');
});
it('preserves explicit authorization decisions while masking authorization credentials',()=>{
  const sanitizer=new Sanitizer();
  const safe=sanitizer.sanitize(JSON.stringify({events:[{authorization:'allowed'},{authorization:'required_group_missing'}],headers:{authorization:'Bearer private-token'},other:{authorization:'Basic dXNlcjpwYXNzd29yZA=='}}),'json',[]);
  expect(safe).toContain('allowed');expect(safe).toContain('required_group_missing');
  expect(safe).not.toContain('private-token');expect(safe).not.toContain('dXNlcjpwYXNzd29yZA==');
  expect(sanitizer.text('status=200 authorization=allowed')).toContain('authorization=allowed');
  expect(sanitizer.text('status=403 authorization=denied')).toContain('authorization=denied');
  expect(sanitizer.text('authorization=arbitrary-secret')).not.toContain('arbitrary-secret');
  expect(sanitizer.text('42 allowed responses')).toBe('42 allowed responses');
});
