import { useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import FullscreenSection from '../components/FullscreenSection';
import { EvidenceCitations } from './InvestigationProgress';
import type { EvidenceSource } from '../evidence/investigation';
import { parseReply } from './response';
import { FollowupContext } from './rendering/FollowupContext';
import { responseLibrary } from './rendering/responseLibrary';
import { replyProgram } from './rendering/replyProgram';
import { restoreReply } from './restoreReply';

export default function AgentResponse({
  content,
  onFollow,
  evidence = [],
  restoreText = (text: string) => text,
}: {
  content: string;
  onFollow: (prompt: string) => void;
  evidence?: EvidenceSource[];
  restoreText?: (text: string) => string;
}) {
  const reply = restoreReply(parseReply(content), restoreText);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed ? (
        <FullscreenSection title="Response">
          <p>{reply.text}</p>
        </FullscreenSection>
      ) : (
        <FollowupContext.Provider value={onFollow}>
          <Renderer
            library={responseLibrary}
            response={replyProgram(reply)}
            isStreaming={false}
            onError={(errors) => {
              if (errors.some((e) => e.severity !== 'warning')) setFailed(true);
            }}
          />
        </FollowupContext.Provider>
      )}
      <EvidenceCitations ids={reply.sources ?? []} evidence={evidence} />
      {evidence.length > 0 &&
        !reply.sources?.length &&
        reply.blocks.some((block) => block.type === 'chart' || block.type === 'table') && (
          <p className="muted">No source references were provided for these results.</p>
        )}
    </>
  );
}
