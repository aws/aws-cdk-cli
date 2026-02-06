import * as chalk from 'chalk';

const ADDITION = chalk.green('[+]');
const UPDATE = chalk.yellow('[~]');
const REMOVAL = chalk.red('[-]');

/**
 * Formatter for Fn::ForEach diff output
 */
export class ForEachDiffFormatter {
  /**
   * Format a ForEach resource difference
   */
  public formatForEach(
    key: string,
    oldValue: any | undefined,
    newValue: any | undefined,
  ): string[] {
    const lines: string[] = [];
    const changeType = this.getChangeType(oldValue, newValue);
    const value = newValue ?? oldValue;

    const loopName = key.replace('Fn::ForEach::', '');
    const [collection, templateObj] = value;
    const [[templateKey, templateValue]] = Object.entries(templateObj as Record<string, any>);

    const count = Array.isArray(collection)
      ? `${collection.length} resources`
      : 'dynamic count';

    lines.push(
      `${this.changeSymbol(changeType)} ${chalk.cyan(key)} (expands to ${count} at deploy time)`,
    );
    lines.push(`    Loop variable: ${chalk.blue(loopName)}`);
    lines.push(`    Collection: ${this.formatCollection(collection)}`);
    lines.push(`    └── ${templateKey} ${chalk.cyan(templateValue.Type)}`);

    if (changeType === 'update' && oldValue && newValue) {
      const oldProps = oldValue[1][Object.keys(oldValue[1])[0]]?.Properties ?? {};
      const newProps = newValue[1][Object.keys(newValue[1])[0]]?.Properties ?? {};
      const propDiff = this.diffProperties(oldProps, newProps);
      lines.push(...propDiff.map(l => `        ${l}`));
    } else {
      for (const [propKey, propValue] of Object.entries(templateValue.Properties ?? {})) {
        lines.push(`        ${propKey}: ${this.formatValue(propValue)}`);
      }
    }

    return lines;
  }

  private changeSymbol(type: 'add' | 'remove' | 'update'): string {
    switch (type) {
      case 'add': return ADDITION;
      case 'remove': return REMOVAL;
      case 'update': return UPDATE;
    }
  }

  private formatCollection(collection: any): string {
    if (Array.isArray(collection)) {
      if (collection.length <= 5) return JSON.stringify(collection);
      return `[${collection.slice(0, 3).join(', ')}, ... +${collection.length - 3} more]`;
    }
    return JSON.stringify(collection);
  }

  private getChangeType(oldVal: any, newVal: any): 'add' | 'remove' | 'update' {
    if (!oldVal) return 'add';
    if (!newVal) return 'remove';
    return 'update';
  }

  private formatValue(value: any): string {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  private diffProperties(oldProps: Record<string, any>, newProps: Record<string, any>): string[] {
    const lines: string[] = [];
    const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);

    for (const key of allKeys) {
      const oldVal = oldProps[key];
      const newVal = newProps[key];

      if (oldVal === undefined) {
        lines.push(`${ADDITION} ${key}: ${this.formatValue(newVal)}`);
      } else if (newVal === undefined) {
        lines.push(`${REMOVAL} ${key}: ${this.formatValue(oldVal)}`);
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        lines.push(`${UPDATE} ${key}: ${this.formatValue(oldVal)} → ${this.formatValue(newVal)}`);
      }
    }

    return lines;
  }
}

/**
 * Check if a logical ID represents a ForEach construct
 */
export function isForEachKey(logicalId: string): boolean {
  return logicalId.startsWith('Fn::ForEach::');
}
