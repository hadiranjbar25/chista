import { Cloud, Terminal } from 'lucide-react';
import ChoiceGroup from '../../components/ChoiceGroup';
export default function AgentPicker({
  value,
  onChange,
  hosted,
  compact = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  hosted: { endpoint: string; model: string };
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <ChoiceGroup
      label={compact ? 'Chat agent' : 'Active agent'}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={compact ? 'agent-choices agent-choices-compact' : 'agent-choices'}
      options={[
        {
          value: 'claude',
          label: 'Claude Code',
          icon: <Terminal size={16} />,
          description: compact ? undefined : 'Use your installed Claude Code CLI.',
        },
        {
          value: 'codex',
          label: 'Codex',
          icon: <Terminal size={16} />,
          description: compact ? undefined : 'Use your installed Codex CLI.',
        },
        ...(!compact || hosted.endpoint
          ? [
              {
                value: 'hosted',
                label: hosted.model || 'Hosted provider',
                icon: <Cloud size={16} />,
                disabled: !hosted.endpoint,
                description: compact
                  ? undefined
                  : hosted.endpoint
                    ? 'Use your configured cloud provider.'
                    : 'Configure a provider below to enable.',
              },
            ]
          : []),
      ]}
    />
  );
}
