import React from 'react';

export interface FlexProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  title?: string;
  onClick?: () => void;
  className?: string;
}

export const Flex = React.forwardRef<HTMLDivElement, FlexProps>(function Flex(props, ref): JSX.Element {
  return <div
    ref={ref}
    className={props.className}
    title={props.title}
    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', ...props.style }}
    onClick={props.onClick}
  >{props.children}</div>;
});

export function FlexFix({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={{ flex: '0 0 auto', ...style }}>{children}</div>;
}

export function FlexGrow({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={{ flex: '1 1 auto', ...style }}>{children}</div>;
}
