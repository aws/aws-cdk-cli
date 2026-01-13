import * as fs from 'fs';
import * as util from 'util';
import { IO } from '../lib/api/io/private/messages';

function codesToMarkdownTable(codes: Record<string, {
  code: string;
  level: string;
  description: string;
  interface?: string;
}>, mdPrefix?: string, mdPostfix?: string) {
  let table = '| Code | Description | Level | Payload data interface |\n';
  table += '|------|-------------|-------|------------------------|\n';

  Object.values(codes).forEach((msg) => {
    table += `| \`${msg.code}\` | ${msg.description} | \`${msg.level}\` | ${msg.interface ? linkInterface(msg.interface) : 'n/a'} |\n`;
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
title: Messages and payloads
group: Documents
---
# Messages and payloads

The CDK Toolkit emits *messages* and *requests* to structure interactions.
A *request* is a special *message* that allows the receiver to respond, if no response is returned the toolkit will continue with a default.
Messages are unidirectional and always send from the CDK Toolkit to your integration.

All messages include text that is suitable for display to an end-user or logging.
Some messages also include a unique \`code\` and a additional payload \`data\`, providing you with structured information for your integration.
*Requests* always have a \`code\` and can be addressed explicitly.
See ${linkInterface('IoMessage')} and ${linkInterface('IoRequest')} for a complete list of available fields.

## Levels

Messages have a \`level\` assigned to them.
Levels are ordered by their importance, with \`error\` being the most and \`trace\` being the least important.

| Level      | Description                                    |
| ---------- | ---------------------------------------------- |
| \`error\`  | Error messages that may affect operation.      |
| \`result\` | Primary message of an operation.               |
| \`warn\`   | Warning messages that don't prevent operation. |
| \`info\`   | General informational messages.                |
| \`debug\`  | Detailed messages for troubleshooting.         |
| \`trace\`  | Very detailed execution flow information.      |

Attached levels are an informal recommendation of what *we* believe is the relevance of a specific message.
Your integration will always receive all messages of all levels.
It is up to you to filter out irrelevant messages.
For standard operations, we recommend to display all messages with level \`info\` or above.

## Backwards compatibility

Messages and requests are an essential part of the CDK Toolkit's public contract.
We recognize integrators will build critical workflows depending on these structured interactions.
To help integrators build with confidence, we provide clear expectations with regards to backwards compatibility of messages.

**Depend only on messages and requests with a \`code\`. Treat all other messages as informational only.**
If a message does not have a code, it can change or disappear at any time without notice.

**Only the \`code\` and \`data\` properties of a message are in scope for backwards compatibility.**
Payload data can change, but we will only make type-compatible, additive changes.
For example we may add new data, but will not remove information.

For the avoidance of doubt, the following changes are explicitly not considered breaking:

- a change to the message text or level,
- a change to the default response of a request,
- a change to the order messages and requests are emitted in,
- the addition of new messages and requests, and
- the removal of messages without a code

## Registry

This is the complete list of all currently available messages with codes and their respective payload interface.
We are welcoming requests for additional coded messages and data.
Please let us know by [opening an issue](https://github.com/aws/aws-cdk-cli/issues/new/choose).`,
));
