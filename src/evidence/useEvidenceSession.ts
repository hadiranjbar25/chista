import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { compact, Sanitizer, sanitizeArtifacts, type Artifact } from './safety';
import type { SafeSessionProps } from './evidenceTypes';
import type { EvidenceTab } from './navigationConfig';
import { MAX_ARTIFACTS, MAX_ARTIFACT_BYTES, SUPPORTED_FORMATS } from './artifactConfig';
import {
  DEFAULT_CONTEXT_BUDGET,
  CONTEXT_EXPORT_FILENAME,
  DOWNLOAD_URL_LIFETIME_MS,
} from './contextConfig';

export function useEvidenceSession({
  ref,
  onAttachments,
  onContext,
  onOpenChat,
  artifactView = false,
  sharedSanitizer,
}: SafeSessionProps) {
  useEffect(() => {
    if (artifactView) setTab('Overview');
  }, [artifactView]);
  const sanitizer = useRef(sharedSanitizer ?? new Sanitizer());
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Artifact[]>([]);
  const [tab, setTab] = useState<EvidenceTab>('Overview');
  const [active, setActive] = useState('');
  const [terms, setTerms] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [raw, setRaw] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [budget, setBudget] = useState(DEFAULT_CONTEXT_BUDGET);
  const [pair, setPair] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [chatIds, setChatIds] = useState<string[]>([]);
  const chatPicker = useRef(false);
  useEffect(() => {
    const element = input.current;
    const cancel = () => {
      chatPicker.current = false;
    };
    element?.addEventListener('cancel', cancel);
    return () => element?.removeEventListener('cancel', cancel);
  }, []);
  useEffect(() => {
    const attached = files.filter((file) => file.selected && chatIds.includes(file.id));
    onAttachments?.({
      files: attached.map(({ id, name, redactions }) => ({ id, name, redactions })),
      context: attached.length ? compact(attached, budget) : null,
      busy,
      error,
    });
  }, [files, chatIds, budget, busy, error, onAttachments]);
  useImperativeHandle(
    ref,
    () => ({
      openFilePicker: () => {
        if (!busy) {
          chatPicker.current = true;
          input.current?.click();
        }
      },
      removeAttachment: (id) => {
        setChatIds((ids) => ids.filter((value) => value !== id));
        apply(files.map((file) => (file.id === id ? { ...file, selected: false } : file)));
      },
    }),
    [busy, files, terms],
  );
  const selected = files.filter((f) => f.selected);
  const current = files.find((f) => f.id === active) ?? files[0];
  const total = files.reduce((n, f) => n + f.redactions, 0);
  function apply(next: Artifact[], custom = terms) {
    onContext(null);
    const updated = sanitizeArtifacts(
      next,
      sanitizer.current,
      custom.split('\n').map((s) => s.trim()),
    );
    setFiles(updated);
    setPreview(null);
    setApproved(false);
  }
  async function importFiles(list: FileList | null, attachToChat = false) {
    if (!list?.length || busy) return;
    setBusy(true);
    setError('');
    try {
      if (files.length + list.length > MAX_ARTIFACTS)
        throw new Error('Use at most 20 artifacts per workspace.');
      const additions: Artifact[] = [];
      for (const f of Array.from(list)) {
        const format = f.name.split('.').pop()?.toLowerCase() ?? '';
        if (!SUPPORTED_FORMATS.includes(format))
          throw new Error('Supported formats: CSV, TSV, JSON, LOG and TXT.');
        if (f.size > MAX_ARTIFACT_BYTES)
          throw new Error('Each artifact must be smaller than 2 MB.');
        const text = await f.text();
        if (text.includes('\0')) throw new Error('Binary files are not supported.');
        additions.push({
          id: crypto.randomUUID(),
          name: f.name,
          format,
          raw: text,
          safe: '',
          redactions: 0,
          selected: true,
        });
      }
      apply([...files, ...additions]);
      setActive(additions[0]?.id ?? active);
      setNotice(`${additions.length} artifact(s) imported and sanitized locally.`);
      if (attachToChat) setChatIds((ids) => [...ids, ...additions.map((file) => file.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  function download() {
    if (!approved || !preview) return;
    const url = URL.createObjectURL(new Blob([preview], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = CONTEXT_EXPORT_FILENAME;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
    setNotice('Reviewed context exported. Nothing was sent to an AI service.');
  }
  const left = files.find((f) => f.id === pair[0]);
  const right = files.find((f) => f.id === pair[1]);

  function browseFiles() {
    chatPicker.current = false;
    input.current?.click();
  }
  function selectArtifact(id: string) {
    setActive(id);
    setTab('Redaction review');
  }
  function prepareContext() {
    setPreview(compact(files, budget));
    setApproved(false);
  }
  function changeBudget(value: number) {
    setBudget(value);
    setPreview(compact(files, value));
    setApproved(false);
  }
  function attachContext() {
    if (!approved || !preview) return;
    setChatIds([]);
    onContext(preview);
    setPreview(null);
    setNotice(
      'Reviewed snapshot attached to this session. Only sanitized context is available to the agent.',
    );
    onOpenChat?.();
  }
  return {
    files,
    tab,
    setTab,
    active,
    setActive,
    terms,
    setTerms,
    notice,
    setNotice,
    error,
    setError,
    raw,
    setRaw,
    preview,
    setPreview,
    approved,
    setApproved,
    budget,
    pair,
    setPair,
    busy,
    selected,
    current,
    total,
    apply,
    importFiles,
    download,
    left,
    right,
    input,
    chatPicker,
    sanitizer,
    browseFiles,
    selectArtifact,
    prepareContext,
    changeBudget,
    attachContext,
  };
}
export type EvidenceController = ReturnType<typeof useEvidenceSession>;
