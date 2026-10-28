import type { Ref } from 'react';
import type { Sanitizer } from './safety';
import type { EvidenceSource } from './investigation';
import type { ChatAttachments } from '../app/workspaces/workspace';

export type SafeSessionHandle = {
  openFilePicker: () => void;
  removeAttachment: (id: string) => void;
};
export type SafeSessionProps = {
  sharedSanitizer?: Sanitizer;
  extraEvidence?: EvidenceSource[];
  ref?: Ref<SafeSessionHandle>;
  onAttachments?: (attachments: ChatAttachments) => void;
  onContext: (context: string | null) => void;
  onOpenChat?: () => void;
  artifactView?: boolean;
};
