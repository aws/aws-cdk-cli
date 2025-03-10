import * as fs from 'fs';
import * as util from 'util';
import { IO } from '../lib/api/shared-public';

function codesToMarkdownTable(codes: Record<string, {
  code: string;
  level: string;
  description: string;
  interface?: string;
}>, mdPrefix?: string, mdPostfix?: string) {
  let table = '| Code | Description | Level | Data Interface |\n';
  table += '|------|-------------|-------|----------------|\n';

  Object.entries(codes).forEach(([key, code]) => {
    // we allow DEFAULT_* as special case here
    if (key !== code.code && !key.startsWith('DEFAULT_')) {
      throw new Error(`Code key ${key} does not match code.code ${code.code}. This is probably a typo.`);
    }
    table += `| \`${code.code}\` | ${code.description} | \`${code.level}\` | ${code.interface ? linkInterface(code.interface) : 'n/a'} |\n`;
  });

  const prefix = mdPrefix ? `${mdPrefix}\n\n` : '';
  const postfix = mdPostfix ? `\n\n${mdPostfix}\n` : '';

  return prefix + table + postfix;
}

function cxApiLink(interfaceName: string) {
  const cxApi = 'https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.%s.html'
  return util.format(cxApi, interfaceName.slice('cxapi.'.length));
}

function linkInterface(interfaceName: string) {
  if (interfaceName.startsWith('cxapi.')) {
    return `[${interfaceName}](${cxApiLink(interfaceName)})`;
  }
  return `{@link ${interfaceName}}`;
}

fs.writeFileSync('docs/message-registry.md', codesToMarkdownTable(
  IO,
  `---
title: IoMessages Registry
group: Documents
---
# IoMessages Registry`,
));
