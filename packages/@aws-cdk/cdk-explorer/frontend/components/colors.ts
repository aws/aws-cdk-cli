import * as awsui from '@cloudscape-design/design-tokens';

export const TOKEN_COLORS: Record<string, string> = {
  keyword: awsui.colorChartsBlue2500,
  string: awsui.colorChartsRed500,
  number: awsui.colorChartsTeal400,
  boolean: awsui.colorChartsBlue2500,
  'attr-name': awsui.colorChartsBlue1500,
  property: awsui.colorChartsBlue1500,
  operator: awsui.colorChartsYellow1000,
  punctuation: awsui.colorChartsYellow1000,
  comment: awsui.colorChartsGreen400,
  'class-name': awsui.colorChartsBlue1300,
  builtin: awsui.colorChartsBlue1300,
  function: awsui.colorChartsOrange700,
  tag: awsui.colorChartsBlue1500,
  selector: awsui.colorChartsBlue1500,
  key: awsui.colorChartsBlue1500,
  'atrule': awsui.colorChartsBlue2500,
  // YAML-specific
  important: awsui.colorChartsTeal400,
  // null/undefined
  'null': awsui.colorChartsBlue2500,
};

