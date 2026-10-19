import Icon from '@cloudscape-design/components/icon';
import TreeView from '@cloudscape-design/components/tree-view';
import * as awsui from '@cloudscape-design/design-tokens';
import * as React from 'react';
import type { WebConstructNode } from '../../../lib/web-shared/protocol';
import type { NavigateEvent, NavigateHandler } from '../nav-types';
import { Flex } from './Flex';
import { colorForSeverity, SEVERITY } from './severities';

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

  public ensureParentsExpanded(constructPath: string): void {
    const parts = constructPath ? constructPath.split('/') : [];
    for (let i = 1; i < parts.length; i++) {
      this.expandedItems.add(parts.slice(0, i).join('/'));
    }
  }

  public isExpanded(constructPath: string): boolean {
    return this.expandedItems.has(constructPath);
  }

  public expand(constructPath: string, what: boolean): void {
    if (what) {
      this.expandedItems.add(constructPath);
    } else {
      this.expandedItems.delete(constructPath);
    }
  }

  public getExpandedItems(): ReadonlyArray<string> {
    return Array.from(this.expandedItems).sort();
  }
}

interface ConstructTreeProps {
  readonly nodes: readonly WebConstructNode[];
  readonly expandState: ExpandState;
  readonly highlightedConstructPath?: string;
  readonly onNavigate: NavigateHandler;
  readonly onDoubleClick?: (WebConstructNode) => void;
}

export function ConstructTree({ nodes, expandState, onNavigate, onDoubleClick, highlightedConstructPath }: ConstructTreeProps): JSX.Element {
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
        content: renderItemWithSeverity(item, highlightedConstructPath === item.path, onClickNode, onDoubleClick),
      })}
      getItemId={item => item.path}
      getItemChildren={item => item.children}
      onItemToggle={onToggleItem}
      ariaLabel="Construct Tree"
    />
  );
}

const MAX_AUTOEXPAND_SIBLINGS = 10;

function scrollToRef(ref: HTMLDivElement) {
  if (ref) {
    ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function renderItemWithSeverity(
  item: WebConstructNode,
  isHighlighted: boolean,
  onClick: (x: WebConstructNode) => void,
  onDoubleClick?: (x: WebConstructNode) => void,
): JSX.Element {
  const highlightColor = colorForSeverity(item.highestSeverity ?? item.inheritedSeverity);
  const attributes = {
    className: isHighlighted ? 'nav-highlight' : undefined,
    style: {
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      ...(isHighlighted ? { ['--nav-highlight-color']: highlightColor ?? awsui.colorChartsBlue1500 } : undefined),

      // Widen the margin a bit so the highlight looks better
      margin: '-2px',
      padding: '2px',
    } as any,
    // title: item.id,
    title: JSON.stringify({
      id: item.id,
      sourceLocation: item.sourceLocation,
      templateLocation: item.templateLocation,
    }, undefined, 2),
    onClick: () => onClick(item),
    onDoubleClick: onDoubleClick ? () => onDoubleClick(item) : undefined,
  };

  const ptrs = [];
  if (item.sourceLocation) {
    ptrs.push(<span style={{ marginLeft: '4px', fontSize: '9px', backgroundColor: awsui.colorChartsTeal300, padding: '1px 4px', color: awsui.colorTextButtonPrimaryHover, borderRadius: '4px' }}>src</span>);
  }
  if (item.templateLocation) {
    ptrs.push(<span style={{ marginLeft: '4px', fontSize: '9px', backgroundColor: awsui.colorChartsYellow300, padding: '1px 4px', color: awsui.colorTextButtonPrimaryHover, borderRadius: '4px' }}>tpl</span>);
  }

  const sev = item.highestSeverity && SEVERITY[item.highestSeverity.toLowerCase()];
  const icon = sev ? <><Icon name={sev.icon} ariaLabel={sev.label} /><span style={{ marginLeft: '4px' }}></span></> : undefined;

  const inh = item.inheritedSeverity && SEVERITY[item.inheritedSeverity.toLowerCase()];
  attributes.style.color = sev?.color ?? inh?.color;

  return <span {...attributes} ref={isHighlighted ? scrollToRef : undefined} key={item.path} className="visible-on-hover-trigger">
    {icon}
    {item.id}
    {ptrs.length > 0 ? <span style={{ marginLeft: '8px' }} className="visible-on-hover" >{...ptrs}</span> : undefined}
  </span>;
}

function navigateArgsFromConstructNode(item: WebConstructNode, trigger: NavigateEvent['trigger']): Parameters<NavigateHandler>[0] {
  return {
    trigger,
    constructPath: item.path,
  };
}
