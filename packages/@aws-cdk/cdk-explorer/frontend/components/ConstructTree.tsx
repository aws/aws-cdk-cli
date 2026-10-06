import { TreeView, Icon, StatusIndicator, SpaceBetween, IconProps } from '@cloudscape-design/components';
import * as React from 'react';
import type { WebConstructNode } from '../api';
import type { NavigateHandler } from '../nav-types';
import { SEVERITY } from './severities';

interface ConstructTreeProps {
  readonly nodes: readonly WebConstructNode[];
  readonly autoExpandDepth?: number;
  readonly onNavigate: NavigateHandler;
}

export function ConstructTree({ nodes, autoExpandDepth = 0, onNavigate }: ConstructTreeProps): JSX.Element {
  const [
    expandedItems,
    setExpandedItems
  ] = React.useState<string[]>(() => pathsTillDepth(nodes, autoExpandDepth));

  return (
    <TreeView items={nodes}
      connectorLines='vertical'
      expandedItems={expandedItems}
      renderItem={item => ({
        icon: (item.children.length > 0 ?
          <Icon
            name='transcript'
            ariaLabel='Construct Group'
          />
          : undefined
        ),
        content: renderItemWithSeverity(item, (item) => {
          if (item.constructPath) {
            expand(item.constructPath, true);
          }
          onNavigate(item);
        }),
      })}
      getItemId={item => item.path}
      getItemChildren={item => item.children}
      onItemToggle={({ detail }) => expand(detail.item.path, detail.expanded)}
      ariaLabel="Construct Tree"
    />
  );

  function expand(constructPath: string, expanded: boolean) {
    setExpandedItems(prev =>
          expanded
            ? [...prev, constructPath]
            : prev.filter(id => id !== constructPath));
  }
}

function pathsTillDepth(nodes: readonly WebConstructNode[], autoExpandDepth: number): string[] {
  const ret: string[] = [];
  recurse(nodes, 1);
  return ret;

  function recurse(nodes: readonly WebConstructNode[], currentDepth: number) {
    if (currentDepth > autoExpandDepth) {
      return;
    }
    for (const node of nodes) {
      ret.push(node.path);
      recurse(node.children, currentDepth + 1);
    }
  }
}

function renderItemWithSeverity(item: WebConstructNode, onClick: NavigateHandler): JSX.Element {
  const attributes = {
    style: {
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    } as any,
    title: item.id,
    onClick: () => onClick(navigateArgsFromConstructNode(item)),
  };

  const sev = item.highestSeverity && SEVERITY[item.highestSeverity.toLowerCase()];
  if (sev) {
    attributes.style.color = sev.color;
    return <SpaceBetween direction="horizontal" size='xxs' nativeAttributes={attributes}>
      <Icon name={sev.icon} ariaLabel={sev.label} />
      <>{item.id}</>
    </SpaceBetween>;
  }

  const inh = item.inheritedSeverity && SEVERITY[item.inheritedSeverity.toLowerCase()];
  if (inh) {
    attributes.style.color = inh.color;
  }

  return <span {...attributes}>{item.id}</span>;
}

function navigateArgsFromConstructNode(item: WebConstructNode): Parameters<NavigateHandler>[0] {
  return {
    constructPath: item.path,
    highestSeverity: item.highestSeverity,
    logicalId: item.logicalId,
    sourceLocation: item.sourceLocation,
    templateFile: item.templateFile,
  };
}