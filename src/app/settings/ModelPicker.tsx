import { useState } from 'react';
import type { ModelChoice } from '../../integrations/models';
import { validModelId } from '../../integrations/models';

type Props = {
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
  value,
  options,
  loading,
  error,
  onChange,
  onLoad,
  disabled,
  compact,
}: Props) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(value);
  const [validation, setValidation] = useState('');
  function applyCustom() {
    const model = draft.trim();
    if (!model || !validModelId(model)) {
      setValidation('Enter a valid model ID without spaces or command flags.');
      return;
    }
    onChange(model);
    setCustom(false);
    setValidation('');
  }
  return (
    <div className={`model-picker${compact ? ' model-picker-compact' : ''}`}>
      <div className="model-picker-controls">
        <label className={compact ? '' : 'field'}>
          {!compact && 'Model'}
          <select
            aria-label={compact ? 'Chat model' : 'Model'}
            value={custom ? '__custom__' : value}
            disabled={disabled}
            onFocus={() => onLoad()}
            onChange={(event) => {
              const selected = event.target.value;
              setValidation('');
              if (selected === '__custom__') {
                setDraft(value);
                setCustom(true);
              } else {
                setCustom(false);
                onChange(selected);
              }
            }}
          >
            <option value="">CLI default model</option>
            {value && !options.some((option) => option.id === value) && (
              <option value={value}>{value}</option>
            )}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value="__custom__">Custom model…</option>
          </select>
        </label>
        {!compact && (
          <button type="button" disabled={disabled || loading} onClick={() => onLoad(true)}>
            {loading ? 'Loading models…' : 'Refresh models'}
          </button>
        )}
      </div>
      {compact && loading && (
        <span className="muted" role="status">
          Loading models…
        </span>
      )}
      {custom && (
        <div className="model-picker-custom">
          <label className="field">
            Custom model ID
            <input
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
        </div>
      )}
      {validation && (
        <p className="error" role="alert">
          {validation}
        </p>
      )}
      {error && (
        <p className="muted" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
