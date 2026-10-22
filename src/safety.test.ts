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
