import * as fs from 'fs';
import type { DaemonInfo } from '../protocol';

export function writeDaemonInfo(infoPath: string, info: DaemonInfo): void {
  fs.writeFileSync(infoPath, JSON.stringify(info) + '\n', 'utf-8');
}

export function readDaemonInfo(infoPath: string): DaemonInfo | undefined {
  try {
    const content = fs.readFileSync(infoPath, 'utf-8');
    return JSON.parse(content) as DaemonInfo;
  } catch {
    return undefined;
  }
}

export function removeDaemonInfo(infoPath: string): void {
  try {
    fs.unlinkSync(infoPath);
  } catch {
    // Already removed or never existed
  }
}
