import { Files, ShieldCheck, GitCompareArrows, Sparkles } from 'lucide-react';

export const EVIDENCE_TABS = [
  { name: 'Overview', icon: Files },
  { name: 'Redaction review', icon: ShieldCheck },
  { name: 'Mappings', icon: Sparkles },
  { name: 'Compare artifacts', icon: GitCompareArrows },
  { name: 'Debug workspace', icon: Sparkles },
] as const;
export type EvidenceTab = (typeof EVIDENCE_TABS)[number]['name'];
export const EVIDENCE_STEPS = [
  'Import & redact',
  'Review mappings',
  'Prepare context',
  'Give to agent',
] as const;
