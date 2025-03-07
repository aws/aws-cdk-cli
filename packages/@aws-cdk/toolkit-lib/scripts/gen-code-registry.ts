import * as fs from 'fs';
import { IO } from '../lib/api/io/private/messages';

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
    table += `| ${code.code} | ${code.description} | ${code.level} | ${code.interface ? linkInterface(code.interface) : 'n/a'} |\n`;
  });

  const prefix = mdPrefix ? `${mdPrefix}\n\n` : '';
  const postfix = mdPostfix ? `\n\n${mdPostfix}\n` : '';

  return prefix + table + postfix;
}

function linkInterface(interfaceName: string) {
  const docSite = 'https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/';
  return `[${interfaceName}](${docSite}${interfaceName}.html)`;
}

fs.writeFileSync('CODE_REGISTRY.md', codesToMarkdownTable(
  IO,
  '## Toolkit Code Registry',
));
