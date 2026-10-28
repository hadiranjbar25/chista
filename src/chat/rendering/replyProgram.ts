import type { AgentReply } from '../response';
import { RESPONSE_DEFAULTS } from '../responseConfig';

export function replyProgram(reply: AgentReply) {
  const q = JSON.stringify;
  const blocks = reply.blocks.map((b) => {
    switch (b.type) {
      case 'chart':
        return `EvidenceChart(${q(b.title)}, ${q(b.items)})`;
      case 'table':
        return `EvidenceTable(${q(b.title)}, ${q(b.columns)}, ${q(b.rows)})`;
      case 'input':
        return `TextInput(${q(b.title)}, ${q(b.placeholder ?? RESPONSE_DEFAULTS.inputPlaceholder)}, ${q(b.submitLabel ?? RESPONSE_DEFAULTS.submitLabel)})`;
      case 'date':
        return `DatePicker(${q(b.title)}, ${q(b.min ?? '')}, ${q(b.max ?? '')}, ${q(b.submitLabel ?? RESPONSE_DEFAULTS.dateSubmitLabel)})`;
      case 'dateRange':
        return `DateRange(${q(b.title)}, ${q(b.submitLabel ?? RESPONSE_DEFAULTS.rangeSubmitLabel)})`;
      case 'form':
        return `DebugForm(${q(b.title)}, ${q(b.fields)}, ${q(b.submitLabel ?? RESPONSE_DEFAULTS.submitLabel)})`;
      case 'code':
        return `CodeViewer(${q(b.title)}, ${q(b.language ?? '')}, ${q(b.content)})`;
      case 'json':
        return `CodeViewer(${q(b.title)}, "JSON", ${q(JSON.stringify(JSON.parse(b.content), null, 2))})`;
      case 'followups':
        return `Followups(${q(b.prompts)})`;
    }
  });
  return `root = Reply(${q(reply.text)}, [${blocks.join(', ')}])`;
}
