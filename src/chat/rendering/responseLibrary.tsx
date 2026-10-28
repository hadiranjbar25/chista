import { useContext } from 'react';
import { createLibrary, defineComponent } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import FullscreenSection from '../../components/FullscreenSection';
import { ResponseForm } from '../widgets/ResponseForm';
import { DateRange } from '../widgets/DateRange';
import { CodeViewer } from '../widgets/CodeViewer';
import { formField } from '../widgetSchema';
import { FollowupContext } from './FollowupContext';
import { Chart, Table } from './EvidenceBlocks';
import { Followups, TextInput, DatePicker } from './FollowupBlocks';

const Form = defineComponent({
  name: 'DebugForm',
  description: 'Validated fields that prepare a chat message.',
  props: z.object({ title: z.string(), fields: z.array(formField), submitLabel: z.string() }),
  component: ({ props }) => (
    <FullscreenSection title={props.title} className="focus-widget">
      <ResponseForm {...props} onSubmit={useContext(FollowupContext)} />
    </FullscreenSection>
  ),
});
const Range = defineComponent({
  name: 'DateRange',
  description: 'Start and end date controls.',
  props: z.object({ title: z.string(), submitLabel: z.string() }),
  component: ({ props }) => (
    <FullscreenSection title={props.title} className="focus-widget">
      <DateRange {...props} onSubmit={useContext(FollowupContext)} />
    </FullscreenSection>
  ),
});
const Code = defineComponent({
  name: 'CodeViewer',
  description: 'Copyable code or formatted JSON, never executed.',
  props: z.object({ title: z.string(), language: z.string(), content: z.string() }),
  component: ({ props }) => (
    <FullscreenSection title={props.title} className="focus-widget">
      <CodeViewer {...props} />
    </FullscreenSection>
  ),
});
const Reply = defineComponent({
  name: 'Reply',
  description: 'Text and optional interactive evidence',
  props: z.object({
    text: z.string(),
    blocks: z.array(
      z.union([
        Chart.ref,
        Table.ref,
        Followups.ref,
        TextInput.ref,
        DatePicker.ref,
        Form.ref,
        Range.ref,
        Code.ref,
      ]),
    ),
  }),
  component: ({ props, renderNode }) => (
    <div className="agent-reply">
      <FullscreenSection title="Response">
        <p>{props.text}</p>
      </FullscreenSection>
      {renderNode(props.blocks)}
    </div>
  ),
});
export const responseLibrary = createLibrary({
  root: 'Reply',
  components: [Reply, Chart, Table, Followups, TextInput, DatePicker, Form, Range, Code],
});
