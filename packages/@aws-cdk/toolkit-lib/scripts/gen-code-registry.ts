import * as fs from 'fs';
import { CODES, CodeInfo } from '../lib/api/io/private/codes';

function objectToMarkdownTable(codes: Record<string, CodeInfo>) {
  let table = '| Code | Description | Level | Data Interface |\n';
  table += '|------|-------------| ----- | -------------- |\n';
  
  Object.entries(codes).forEach(([id, code]) => {
    table += `| ${id} | ${code.description} | ${code.level} | ${code.interface ?? 'n/a'} |\n`;
  });
  
  return table;
}

fs.writeFileSync('CODE_REGISTRY.md', objectToMarkdownTable(CODES));