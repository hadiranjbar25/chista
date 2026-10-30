import type { ToolHooks } from '../integrations/cliTools';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  claudeProvider,
  codexProvider,
  NativeTurnError,
  RetainedTurnError,
} from '../integrations/claude';
import {
  contextEvidence,
  updateActivity,
  type EvidenceSource,
  type ToolActivity,
} from '../evidence/investigation';
import { useChatScroll } from './useChatScroll';
import { useComposerAttachments } from './useComposerAttachments';
import { CliConversation } from '../integrations/conversation';
import { ensureCliSignIn } from '../integrations/signIn';
import type { ToolApproval, McpStatus } from '../integrations/cliTools';
import { sanitizedResult } from '../integrations/cliTools';
import { Sanitizer } from '../evidence/safety';
import { hostedProvider, prepareRequest, type Message } from '../integrations/providers';
import { parseReply } from './response';
import type { AgentChatProps, PendingRequest } from './chatTypes';
import {
  ATTACHED_FILES_PROMPT,
  REQUEST_TIMEOUT_MS,
  DEFAULT_REVIEW_BEFORE_SENDING,
} from './chatConfig';

export function useAgentChat({
  active = true,
  repositories,
  context,
  mode,
  hosted,
  claudePath,
  codexPath = '',
  model = '',
  onSessionTitle,
  onModelStatus,
  attachments,
  sharedSanitizer,
  onEvidence,
}: AgentChatProps) {
  const agentLabel = mode === 'hosted' ? hosted.model : mode === 'codex' ? 'Codex' : 'Claude Code';
  const inFlight = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const executablePath = mode === 'codex' ? codexPath : claudePath;
  const repoSignature = JSON.stringify(repositories.map((r) => [r.id, r.name, r.path]));
  const { composerAttachments, consumeAttachments } = useComposerAttachments(attachments);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [stream, setStream] = useState('');
  const [activities, setActivities] = useState<Record<number, ToolActivity[]>>({});
  const [evidence, setEvidence] = useState<EvidenceSource[]>([]);
  const evidenceRef = useRef<EvidenceSource[]>([]);
  const [responseSources, setResponseSources] = useState<Record<number, EvidenceSource[]>>({});
  const [reviewBeforeSending, setReviewBeforeSending] = useState(DEFAULT_REVIEW_BEFORE_SENDING);
  const [authStatus, setAuthStatus] = useState('');
  const [toolApproval, setToolApproval] = useState<ToolApproval | null>(null);
  const [mcpServers, setMcpServers] = useState<McpStatus[]>([]);
  useEffect(() => setMcpServers([]), [mode, executablePath]);
  const [refreshingMcp, setRefreshingMcp] = useState(false);
  const [openingMcpLogin, setOpeningMcpLogin] = useState(false);
  const mcpRefreshLock = useRef(false);
  const mcpGeneration = useRef(0);
  const mcpLoginPending = useRef<{ mode: string; path: string; server: string } | null>(null);
  const toolDecision = useRef<((approved: boolean) => void) | null>(null);
  function decideTool(approved: boolean) {
    toolDecision.current?.(approved);
    toolDecision.current = null;
    setToolApproval(null);
  }
  useEffect(
    () => () => {
      toolDecision.current?.(false);
    },
    [],
  );

  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const sanitizer = useRef(sharedSanitizer ?? new Sanitizer('CHAT'));
  const composer = useRef<HTMLTextAreaElement>(null);
  const { content: conversation, paused: scrollPaused, jumpToLatest } = useChatScroll(active);
  const conversationState = useRef(new CliConversation());
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      conversationState.current.reset();
    };
  }, []);
  useEffect(() => {
    setPending(null);
  }, [
    context,
    mode,
    claudePath,
    codexPath,
    model,
    hosted.endpoint,
    hosted.model,
    hosted.token,
    repoSignature,
    attachments?.busy,
  ]);
  useEffect(() => {
    if (!active) {
      setPending(null);
      decideTool(false);
    }
  }, [active]);
  useEffect(() => {
    mcpGeneration.current++;
    mcpRefreshLock.current = false;
    mcpLoginPending.current = null;
    setRefreshingMcp(false);
    setOpeningMcpLogin(false);
    setReconnectRequired(false);
    conversationState.current.reset();
    return () => {
      abort.current?.abort();
      conversationState.current.reset();
    };
  }, [mode, executablePath]);
  useEffect(() => {
    // Revoke an in-flight snapshot when selected repos/evidence change, but retain an idle
    // native thread so the next turn can send only the updated evidence.
    abort.current?.abort();
  }, [context, repoSignature]);
  const canSend =
    !busy &&
    !reconnectRequired &&
    !refreshingMcp &&
    !openingMcpLogin &&
    !attachments?.busy &&
    Boolean(prompt.trim() || composerAttachments?.files.length);
  function sendMessage() {
    if (!canSend || inFlight.current || mcpRefreshLock.current) return;
    try {
      if (mode === 'hosted') hostedProvider(hosted);
      if (mode === 'claude') claudeProvider(claudePath);
      if (mode === 'codex') codexProvider(codexPath);
      const request: PendingRequest = {
        attachmentIds: composerAttachments?.files.map((file) => file.id) ?? [],
        request: prepareRequest(
          messages,
          prompt.trim() || ATTACHED_FILES_PROMPT,
          context,
          sanitizer.current,
          repositories.map((repository) => repository.name),
        ),
        config: { ...hosted },
        mode,
        executablePath,
      };
      if (mode !== 'hosted')
        request.turn = conversationState.current.prepare(
          mode,
          executablePath,
          request.request,
          model,
        );
      if (reviewBeforeSending) setPending(request);
      else void execute(request);
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function execute(snapshot: PendingRequest) {
    if (inFlight.current || mcpRefreshLock.current) return;
    inFlight.current = true;
    setPending(null);
    setBusy(true);
    setNotice('');
    setStream('');
    const sentDraft = prompt;
    const turnIndex = snapshot.request.messages.length - 1;
    setActivities((all) => ({ ...all, [turnIndex]: [] }));
    let submitted = false;
    try {
      jumpToLatest();
      const tools: ToolHooks = {
        sanitize: (text) => sanitizer.current.sanitize(text, 'json', []),
        status: setMcpServers,
        activity: (item) => {
          if (mounted.current)
            setActivities((all) => ({
              ...all,
              [turnIndex]: updateActivity(all[turnIndex] ?? [], item),
            }));
        },
        evidence: (source) => {
          if (mounted.current) {
            evidenceRef.current = [...evidenceRef.current, source];
            setEvidence(evidenceRef.current);
            onEvidence?.(source);
          }
        },
        approve: (tool) =>
          !activeRef.current
            ? Promise.resolve(false)
            : new Promise<boolean>((resolve) => {
                toolDecision.current = resolve;
                setToolApproval(tool);
              }),
      };
      const provider =
        snapshot.mode === 'hosted'
          ? hostedProvider(snapshot.config)
          : snapshot.mode === 'codex'
            ? codexProvider(snapshot.executablePath, snapshot.turn, tools)
            : claudeProvider(snapshot.executablePath, snapshot.turn, tools);
      abort.current = new AbortController();
      const signal = abort.current.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (snapshot.mode !== 'hosted')
          await ensureCliSignIn(snapshot.mode, snapshot.executablePath, signal, setAuthStatus);
        signal.throwIfAborted();
        timer = setTimeout(() => abort.current?.abort(), REQUEST_TIMEOUT_MS);
        if (snapshot.mode === 'hosted')
          onModelStatus(
            JSON.stringify([snapshot.config.endpoint, snapshot.config.model]),
            'Connecting…',
          );
        submitted = true;
        setMessages(snapshot.request.messages);
        setPrompt((current) => (current === sentDraft ? '' : current));
        consumeAttachments(snapshot.attachmentIds);
        const reply = await provider.complete(snapshot.request, abort.current.signal, (text) => {
          if (mounted.current) setStream(sanitizer.current.text(text));
        });
        if (snapshot.mode === 'hosted')
          onModelStatus(
            JSON.stringify([snapshot.config.endpoint, snapshot.config.model]),
            'Connected · last request succeeded',
          );
        if (mounted.current) {
          const content = sanitizer.current.sanitize(JSON.stringify(parseReply(reply)), 'json', []);
          const title = parseReply(content).sessionTitle;
          if (title && !snapshot.request.messages.some((message) => message.role === 'assistant'))
            onSessionTitle?.(sanitizer.current.restore(title));
          const next: Message[] = [...snapshot.request.messages, { role: 'assistant', content }];
          if (snapshot.turn) conversationState.current.commit(snapshot.turn, next);
          setResponseSources((all) => ({
            ...all,
            [next.length - 1]: [
              ...contextEvidence(snapshot.request.context),
              ...evidenceRef.current,
            ],
          }));
          setMessages(next);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (submitted && snapshot.mode !== 'hosted') {
        if (error instanceof RetainedTurnError && snapshot.turn)
          conversationState.current.commit(snapshot.turn, snapshot.request.messages);
        else {
          conversationState.current.reset();
          setReconnectRequired(true);
        }
      }
      if (mounted.current && submitted) setMessages(snapshot.request.messages);
      if (snapshot.mode === 'hosted')
        onModelStatus(
          JSON.stringify([snapshot.config.endpoint, snapshot.config.model]),
          'Error · last request failed or cancelled',
        );
      if (mounted.current) {
        let detail = 'Request failed without additional CLI error details.';
        try {
          detail = sanitizedResult(
            error instanceof NativeTurnError && error.detail != null
              ? error.detail
              : { error: String(error) },
            (text) => sanitizer.current.sanitize(text, 'json', []),
          ).slice(0, 60000);
        } catch {
          /* Keep a static diagnostic if sanitization fails. */
        }
        if (submitted && !abort.current?.signal.aborted)
          setActivities((all) => {
            const items = all[turnIndex] ?? [];
            if (items.some((item) => item.state === 'failed' && item.detail)) return all;
            if (items.some((item) => ['approval', 'running'].includes(item.state)))
              return {
                ...all,
                [turnIndex]: items.map((item) =>
                  ['approval', 'running'].includes(item.state)
                    ? { ...item, state: 'failed' as const, detail }
                    : item,
                ),
              };
            return {
              ...all,
              [turnIndex]: [
                ...items,
                {
                  id: `request-error-${turnIndex}`,
                  server: agentLabel,
                  tool: 'request',
                  state: 'failed',
                  detail,
                },
              ],
            };
          });
        setNotice(
          snapshot.mode !== 'hosted'
            ? `${sanitizer.current.text(String(error))} No automatic retry was made.`
            : 'Request failed or was cancelled. Check integration status and permissions. No automatic retry was made.',
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setActivities((all) => ({
          ...all,
          [turnIndex]: (all[turnIndex] ?? []).map((item) =>
            ['approval', 'running'].includes(item.state)
              ? { ...item, state: abort.current?.signal.aborted ? 'cancelled' : 'failed' }
              : item,
          ),
        }));
        setBusy(false);
        setStream('');
        setAuthStatus('');
        decideTool(false);
      }
    }
  }
  const sources = [...contextEvidence(context), ...evidence];

  function stop() {
    decideTool(false);
    setAuthStatus('Stopping…');
    abort.current?.abort();
  }
  async function refreshMcp(server?: string) {
    if (mode === 'hosted' || inFlight.current || mcpRefreshLock.current) return;
    const generation = mcpGeneration.current;
    mcpRefreshLock.current = true;
    setRefreshingMcp(true);
    try {
      const statuses = await invoke<McpStatus[]>('refresh_agent_mcp', {
        sessionKey: conversationState.current.sessionKey(),
        agent: mode,
        executablePath,
        ...(server ? { server } : {}),
      });
      if (!mounted.current || generation !== mcpGeneration.current) return;
      setMcpServers(statuses);
      const pending = mcpLoginPending.current;
      const target = pending ? statuses.find((item) => item.name === pending.server) : null;
      if (target && target.authStatus === 'notLoggedIn') {
        setNotice('Sign-in is still required. Finish native login, then refresh connections.');
      } else {
        mcpLoginPending.current = null;
        setNotice('MCP connections refreshed.');
      }
    } catch (error) {
      if (mounted.current && generation === mcpGeneration.current) setNotice(String(error));
    } finally {
      if (generation === mcpGeneration.current) {
        mcpRefreshLock.current = false;
        if (mounted.current) setRefreshingMcp(false);
      }
    }
  }
  useEffect(() => {
    function returned() {
      const pending = mcpLoginPending.current;
      if (
        active &&
        !inFlight.current &&
        pending?.mode === mode &&
        pending.path === executablePath &&
        document.visibilityState !== 'hidden'
      )
        void refreshMcp(pending.server);
    }
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
    return () => {
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', returned);
    };
  }, [active, mode, executablePath, busy]);
  async function signInMcp(server: string) {
    if (inFlight.current || mcpRefreshLock.current || openingMcpLogin) return;
    const generation = mcpGeneration.current;
    setOpeningMcpLogin(true);
    try {
      const message = await invoke<string>(`${mode}_mcp_sign_in`, { executablePath, server });
      if (!mounted.current || generation !== mcpGeneration.current) return;
      mcpLoginPending.current = { mode, path: executablePath, server };
      setNotice(
        `${message} Connections refresh when you return. You can also use Refresh connections.`,
      );
    } catch (error) {
      if (mounted.current && generation === mcpGeneration.current) setNotice(String(error));
    } finally {
      if (mounted.current && generation === mcpGeneration.current) setOpeningMcpLogin(false);
    }
  }
  return {
    agentLabel,
    restoreText: (text: string) => sanitizer.current.restore(text),
    messages,
    prompt,
    setPrompt,
    stream,
    activities,
    responseSources,
    reviewBeforeSending,
    setReviewBeforeSending,
    authStatus,
    toolApproval,
    mcpServers,
    decideTool,
    pending,
    setPending,
    busy,
    notice,
    reconnectRequired,
    reconnect: () => {
      conversationState.current.reset();
      setReconnectRequired(false);
      setNotice(
        'Ready to reconnect. Your next message will include the conversation and attached context.',
      );
    },
    composer,
    composerAttachments,
    conversation,
    scrollPaused,
    jumpToLatest,
    canSend,
    sendMessage,
    execute,
    sources,
    stop,
    signInMcp,
    refreshMcp,
    refreshingMcp,
    openingMcpLogin,
  };
}
export type ChatController = ReturnType<typeof useAgentChat>;
