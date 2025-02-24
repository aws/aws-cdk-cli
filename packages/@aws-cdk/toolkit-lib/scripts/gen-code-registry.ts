import * as fs from 'fs';
import { CODES, CodeInfo } from '../lib/api/io/private/codes';

function codesToMarkdownTable(codes: Record<string, CodeInfo>, mdPrefix?: string, mdPostfix?: string) {
  let table = '| Code | Description | Level | Data Interface |\n';
  table += '|------|-------------|-------|----------------|\n';
  
  Object.values(codes).forEach((code) => {
    table += `| ${code.code} | ${code.description} | ${code.level} | ${code.interface ? linkInterface(code.interface) : 'n/a'} |\n`;
  });

  const prefix = mdPrefix ? `${mdPrefix}\n\n` : '';
  const postfix = mdPostfix ? `\n\n${mdPostfix}\n` : '';

  return prefix + table + postfix;
}

function linkInterface(interfaceName: string) {
  const docSite = 'docs/interfaces/';
  return `[${interfaceName}](${docSite}${interfaceName}.html)`;
}

fs.writeFileSync('CODE_REGISTRY.md', codesToMarkdownTable(
  CODES,
  '## Toolkit Code Registry',
));
