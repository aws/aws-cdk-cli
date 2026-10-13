import Icon from '@cloudscape-design/components/icon';
import SpaceBetween from '@cloudscape-design/components/space-between';
import TreeView from '@cloudscape-design/components/tree-view';
import * as React from 'react';
import type { WebConstructNode } from '../../lib/web/protocol';
import type { NavigateEvent, NavigateHandler } from '../nav-types';
import { SEVERITY } from './severities';

export class ExpandState {
  private expandedItems: Set<string> = new Set();

  public autoExpand(maxDepth: number, nodes: readonly WebConstructNode[]) {
    recurse.call(this, nodes, 1);

    function recurse(this: ExpandState, ns: readonly WebConstructNode[], currentDepth: number) {
      if (currentDepth > maxDepth || ns.length > MAX_AUTOEXPAND_SIBLINGS) {
        return;
      }
      for (const node of ns) {
        this.expandedItems.add(node.path);
        recurse.call(this, node.children, currentDepth + 1);
      }
    }
  }

  isExpanded(constructPath: string): boolean {
    return this.expandedItems.has(constructPath);
  }

  expand(constructPath: string, what: boolean): void {
    if (what) {
      this.expandedItems.add(constructPath);
    } else {
      this.expandedItems.delete(constructPath);
    }
  }

  getExpandedItems(): ReadonlyArray<string> {
    return Array.from(this.expandedItems).sort();
  }
}

interface ConstructTreeProps {
  readonly nodes: readonly WebConstructNode[];
  readonly expandState: ExpandState;
  readonly onNavigate: NavigateHandler;
}

export function ConstructTree({ nodes, expandState, onNavigate }: ConstructTreeProps): JSX.Element {
  // Necessary because a mutable object manages the expand state
  const [, expandStateChanged] = React.useState({});

  const onClickNode = React.useCallback((item: WebConstructNode) => {
    if (item.path) {
      expandState.expand(item.path, true);
      expandStateChanged({});
    }
    onNavigate(navigateArgsFromConstructNode(item, 'tree'));
  }, [onNavigate]);

  const onToggleItem = React.useCallback(({ detail }: { detail: { item: WebConstructNode; expanded: boolean } }) => {
    expandState.expand(detail.item.path, detail.expanded);
    expandStateChanged({});
  }, [expandState]);

  return (
    <TreeView items={nodes}
      connectorLines='vertical'
      expandedItems={expandState.getExpandedItems()}
      renderItem={item => ({
        icon: (item.children.length > 0 ? <Icon name='transcript' ariaLabel='Construct Group' /> : undefined),
        content: renderItemWithSeverity(item, onClickNode),
      })}
      getItemId={item => item.path}
      getItemChildren={item => item.children}
      onItemToggle={onToggleItem}
      ariaLabel="Construct Tree"
    />
  );
}

const MAX_AUTOEXPAND_SIBLINGS = 10;

function renderItemWithSeverity(item: WebConstructNode, onClick: (x: WebConstructNode) => void): JSX.Element {
  const attributes = {
    style: {
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    } as any,
    title: item.id,
    onClick: () => onClick(item),
  };

  const ptr = item.templateLocation || item.sourceLocation
    ? <Icon name='internal-link' ariaLabel='View' variant='subtle' />
    : <></>;

  const sev = item.highestSeverity && SEVERITY[item.highestSeverity.toLowerCase()];
  if (sev) {
    attributes.style.color = sev.color;
    return <SpaceBetween direction="horizontal" size='xxs' nativeAttributes={attributes}>
      <Icon name={sev.icon} ariaLabel={sev.label} />
      {item.id}
      {ptr}
    </SpaceBetween>;
  }

  const inh = item.inheritedSeverity && SEVERITY[item.inheritedSeverity.toLowerCase()];
  if (inh) {
    attributes.style.color = inh.color;
  }

  return <span {...attributes}>{item.id} {ptr}</span>;
}

function navigateArgsFromConstructNode(item: WebConstructNode, trigger: NavigateEvent['trigger']): Parameters<NavigateHandler>[0] {
  return {
    trigger,
    constructPath: item.path,
  };
}
