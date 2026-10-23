import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DebugView from './DebugView';
import { sanitizeArtifacts, Sanitizer } from './safety';
import { samples } from './test-fixtures';
describe('OpenUI evidence rendering', () => {
 it('renders its chart, evidence table and follow-up controls from sanitized content', () => {
  const files = sanitizeArtifacts(samples.map((f,i) => ({...f,id:String(i),safe:'',redactions:0,selected:true})),new Sanitizer(),[]);
  const html = renderToStaticMarkup(<DebugView files={files} onFollow={() => {}}/>);
  expect(html).toContain('Event distribution');
  expect(html).toContain('Inspect errors');
  expect(html).toContain('[EMAIL_1]');
  expect(html).not.toContain('alex@example.com');
  expect(html).not.toContain('sk-demoSecret123456');
 });
});
