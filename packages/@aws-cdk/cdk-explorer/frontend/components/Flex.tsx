export function Flex({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', ...style }}>{children}</div>;
}

export function FlexFix({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={{ flex: '0 0 auto', ...style }}>{children}</div>;
}

export function FlexGrow({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={{ flex: '1 1 auto', ...style }}>{children}</div>;
}
