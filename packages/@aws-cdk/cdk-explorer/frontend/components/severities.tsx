import Icon, { type IconProps } from '@cloudscape-design/components/icon';
import * as awsui from '@cloudscape-design/design-tokens';

export const SEVERITY: Record<string, { color: string; icon: IconProps.Name; label: string }> = {
  fatal: { color: awsui.colorChartsStatusCritical, icon: 'status-negative', label: 'Fatal' },
  error: { color: awsui.colorChartsStatusHigh, icon: 'status-stopped', label: 'Error' },
  warning: { color: awsui.colorChartsStatusMedium, icon: 'status-warning', label: 'Warning' },
  info: { color: awsui.colorChartsStatusInfo, icon: 'status-info', label: 'Info' },
};

export function colorForSeverity(severity: string | undefined): string {
  return SEVERITY[severity ?? '']?.color ?? awsui.colorTextActionCardDisabled;
}

export function iconForSeverity(severity: string | undefined, customSeverity: string | undefined): JSX.Element {
  const sev = SEVERITY[severity?.toLowerCase() ?? ''];
  const iconName = sev?.icon ?? 'status-not-started';
  const severityName = severity === 'custom' ? customSeverity : sev?.label ?? severity;
  return <Icon name={iconName} ariaLabel={severityName} nativeAttributes={{ style: { color: colorForSeverity(severity) } }}/>;
}
