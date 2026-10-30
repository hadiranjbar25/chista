import type { ModelCatalog } from '../integrations/models';
import type { EvidenceSource } from '../evidence/investigation';
import type { Sanitizer } from '../evidence/safety';
import type { Repository, ChatAttachments } from '../app/workspaces/workspace';
import type { NativeTurn } from '../integrations/conversation';
import type { HostedConfig, ModelRequest } from '../integrations/providers';

export type PendingRequest = {
  attachmentIds: string[];
  request: ModelRequest;
  config: HostedConfig;
  mode: string;
  executablePath: string;
  turn?: NativeTurn;
};
export type AgentChatProps = {
  model?: string;
  modelCatalog?: ModelCatalog;
  onModelChange?: (model: string) => void;
  onLoadModels?: (refresh?: boolean) => void;
  sharedSanitizer?: Sanitizer;
  onEvidence?: (source: EvidenceSource) => void;
  active?: boolean;
  repositories: Repository[];
  context: string | null;
  mode: string;
  hosted: HostedConfig;
  claudePath: string;
  codexPath?: string;
  onAgentChange?: (mode: string) => void;
  attachments?: ChatAttachments;
  onRemoveAttachment?: (id: string) => void;
  onSessionTitle?: (title: string) => void;
  onFiles: () => void;
  onAddFiles: () => void;
  onModelStatus: (key: string, status: string) => void;
};
