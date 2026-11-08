import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, RefreshCw, Plus, X } from 'lucide-react';
import ChoiceGroup from '../../components/ChoiceGroup';
import type { CliAgent, ModelChoice } from '../../integrations/models';
import { validModelId } from '../../integrations/models';
type Props = {
  agent: CliAgent;
  value: string;
  options: ModelChoice[];
  loading: boolean;
  error: string;
  onChange: (model: string) => void;
  onLoad: (refresh?: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
};
export default function ModelPicker({
  agent,
  value,
  options,
  loading,
  error,
  onChange,
  onLoad,
  disabled,
  compact,
}: Props) {
  const agentLabel = agent === 'claude' ? 'Claude' : 'Codex';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(value);
  const [validation, setValidation] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const defaultLabel = `${agentLabel} CLI default model`;
  const selected = options.find((option) => option.id === value)?.label ?? (value || defaultLabel);
  const choices = [
    { id: '', label: defaultLabel },
    ...(value && !options.some((option) => option.id === value)
      ? [{ id: value, label: `${value} (custom)` }]
      : []),
    ...options,
  ];
  const filtered = choices.filter((option) =>
    `${option.label} ${option.id}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  useEffect(() => {
    if (disabled || loading) setOpen(false);
  }, [disabled, loading]);
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => {
    if (custom) customInput.current?.focus();
  }, [custom]);
  function choose(model: string) {
    onChange(model);
    setCustom(false);
    setValidation('');
    setOpen(false);
    trigger.current?.focus();
  }
  function applyCustom() {
    const model = draft.trim();
    if (!model || !validModelId(model)) {
      setValidation('Enter a valid model ID without spaces or command flags.');
      return;
    }
    choose(model);
  }
  return (
    <div
      ref={root}
      className={`model-picker${compact ? ' model-picker-compact' : ''}`}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <div className="model-picker-controls">
        <button
          ref={trigger}
          type="button"
          className="model-picker-trigger"
          aria-label={`${compact ? 'Chat model' : 'Model'}: ${loading ? `Loading ${agentLabel} models…` : selected}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled || loading}
          onClick={() => {
            setSearch('');
            setOpen(!open);
          }}
        >
          <span>{loading ? `Loading ${agentLabel} models…` : selected}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {!compact && (
          <button type="button" disabled={disabled || loading} onClick={() => onLoad(true)}>
            <RefreshCw size={14} aria-hidden="true" />
            {loading ? 'Loading models…' : 'Refresh models'}
          </button>
        )}
      </div>
      {open && (
        <div
          role="dialog"
          aria-label="Choose a model"
          aria-modal="false"
          className="model-picker-popover"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <div className="model-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInput}
              aria-label="Search models"
              value={search}
              placeholder="Search models…"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (filtered.length === 1) choose(filtered[0].id);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  root.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus();
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Close model picker"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          </div>
          {filtered.length ? (
            <ChoiceGroup
              label={compact ? 'Chat model' : 'Model'}
              value={value}
              options={filtered.map((option) => ({
                value: option.id,
                label: option.label,
                description: option.id || 'Follow the model configured in your CLI.',
                icon: option.id === value ? <Check size={14} /> : undefined,
              }))}
              onChange={choose}
              className="model-choices"
            />
          ) : (
            <p className="empty">No matching models.</p>
          )}
          <div className="model-picker-footer">
            <button
              type="button"
              onClick={() => {
                setDraft(search || value);
                setCustom(true);
                setValidation('');
                setOpen(false);
              }}
            >
              <Plus size={14} aria-hidden="true" />
              Custom model…
            </button>
            <button type="button" aria-label="Refresh model list" onClick={() => onLoad(true)}>
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {custom && (
        <div className="model-picker-custom">
          <label className="field">
            Custom model ID
            <input
              ref={customInput}
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyCustom();
                }
              }}
              placeholder="Enter a model ID"
            />
          </label>
          <button type="button" disabled={disabled} onClick={applyCustom}>
            Use model
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setCustom(false);
              setValidation('');
              trigger.current?.focus();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {validation && (
        <p className="error" role="alert">
          {validation}
        </p>
      )}
      {!compact && error && (
        <p className="muted" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
