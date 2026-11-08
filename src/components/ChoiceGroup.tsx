import { useId, useRef, type ReactNode } from 'react';
export type Choice = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};
export default function ChoiceGroup({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
}: {
  label: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const id = useId();
  const tabStop =
    options.find((option) => option.value === value && !option.disabled)?.value ??
    options.find((option) => !option.disabled)?.value;
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={`choice-group ${className}`}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-label={option.label}
          aria-checked={option.value === value}
          aria-describedby={option.description ? `${id}-${index}` : undefined}
          disabled={disabled || option.disabled}
          tabIndex={option.value === tabStop ? 0 : -1}
          className={`choice-option${option.value === value ? ' is-selected' : ''}`}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const buttons = [
              ...(group.current?.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]:not(:disabled)',
              ) ?? []),
            ];
            const current = buttons.indexOf(event.currentTarget);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (current +
                      (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
            buttons[next]?.click();
          }}
        >
          {option.icon && (
            <span className="choice-icon" aria-hidden="true">
              {option.icon}
            </span>
          )}
          <span className="choice-copy">
            <span className="choice-label">{option.label}</span>
            {option.description && (
              <span className="choice-description" id={`${id}-${index}`}>
                {option.description}
              </span>
            )}
          </span>
          <span className="choice-indicator" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
