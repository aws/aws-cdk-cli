import { Icon, type IconProps } from '@cloudscape-design/components';

export const NEUTRAL_COLOR = '#5f6b7a';

export const SEVERITY: Record<string, { color: string; icon: IconProps.Name; label: string }> = {
  fatal: { color: '#d91515', icon: 'status-negative', label: 'Fatal' },
  error: { color: '#e07700', icon: 'status-stopped', label: 'Error' },
  warning: { color: '#8d6605', icon: 'status-warning', label: 'Warning' },
  info: { color: '#0972d3', icon: 'status-info', label: 'Info' },
};

export function colorForSeverity(severity: string | undefined): string {
  if (!severity) {
    return NEUTRAL_COLOR;
  }
  return SEVERITY[severity]?.color ?? NEUTRAL_COLOR;
}

export function iconForSeverity(severity: string | undefined, customSeverity: string | undefined): JSX.Element {
  const sev = SEVERITY[severity?.toLowerCase() ?? ''];
  const iconName = sev?.icon ?? 'status-not-started';
  const severityName = severity === 'custom' ? customSeverity : sev?.label ?? severity;
  return <Icon name={iconName} ariaLabel={severityName} nativeAttributes={{ style: { color: colorForSeverity(severity) } }}/>;
}