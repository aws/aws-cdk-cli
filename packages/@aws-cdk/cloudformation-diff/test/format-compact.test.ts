import { Writable } from 'stream';
import { stripVTControlCharacters } from 'util';
import { formatCompactList, formatDifferences, formatSecurityChanges, fullDiff } from '../lib';
import { poldoc, resource, template } from './util';

describe('formatCompactList', () => {
  test('renders one line per row, with header names, joined multi-line cells and no empty cells', () => {
    const output = formatCompactList([
      ['', 'Resource', 'Effect', 'Action', 'Condition'],
      ['+', 'arn:a\narn:b', 'Allow', 's3:GetObject\ns3:PutObject', ''],
      ['-', '*', 'Deny', 'sqs:SendMessage', ''],
    ]);

    expect(output).toEqual([
      '+ Resource: arn:a, arn:b; Effect: Allow; Action: s3:GetObject, s3:PutObject',
      '- Resource: *; Effect: Deny; Action: sqs:SendMessage',
    ].join('\n'));
  });

  test('a header without rows renders nothing', () => {
    expect(formatCompactList([['', 'Resource']])).toEqual('');
  });
});

describe('compact security tables', () => {
  const diff = fullDiff({}, template({
    QueuePolicy: resource('AWS::SQS::QueuePolicy', {
      Queues: [{ Ref: 'MyQueue' }],
      PolicyDocument: poldoc({
        Effect: 'Allow',
        Action: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
        Resource: ['arn:aws:sqs:us-east-1:123456789012:queue-a', 'arn:aws:sqs:us-east-1:123456789012:queue-b'],
        Principal: { Service: 'sns.amazonaws.com' },
        Condition: { StringEquals: { 'aws:SourceAccount': '123456789012' } },
      }),
    }),
    Group: resource('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [{ CidrIp: '10.0.0.0/16', FromPort: 443, ToPort: 443, IpProtocol: 'tcp' }],
    }),
  }));

  test('the security diff is a compact list with every value of the table', () => {
    const table = render((s) => formatSecurityChanges(s, diff));
    const compact = render((s) => formatSecurityChanges(s, diff, {}, undefined, { compactTables: true }));

    expect(compact).toContain('IAM Statement Changes');
    expect(compact).toContain('Security Group Changes');
    expect(compact).not.toMatch(/[┌┬┐├┼┤└┴┘│]/);
    for (const value of tableValues(table)) {
      expect(compact).toContain(value);
    }
    expect(compact.length).toBeLessThan(table.length);
  });

  test('the full diff uses the compact list too when asked', () => {
    const compact = render((s) => formatDifferences(s, diff, {}, 3, { compactTables: true }));

    expect(compact).toContain('IAM Statement Changes');
    expect(compact).not.toMatch(/[┌┬┐├┼┤└┴┘│]/);
  });

  test('the default is still the bordered table', () => {
    const table = render((s) => formatSecurityChanges(s, diff));
    const tableWithEmptyOptions = render((s) => formatSecurityChanges(s, diff, {}, undefined, {}));

    expect(table).toMatch(/[┌┬┐├┼┤└┴┘│]/);
    expect(tableWithEmptyOptions).toEqual(table);
  });
});

/**
 * Run a formatter against a stream and return the output, without styling
 */
function render(fn: (stream: NodeJS.WritableStream) => void): string {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  fn(stream);
  return stripVTControlCharacters(output);
}

/**
 * The values in the cells of a bordered table (not the borders or the header row)
 */
function tableValues(table: string): string[] {
  const headers = new Set(['Resource', 'Effect', 'Action', 'Principal', 'Condition', 'Group', 'Dir', 'Protocol', 'Peer']);
  return table.split('\n')
    .filter((line) => line.includes('│'))
    .flatMap((line) => line.split('│').map((cell) => cell.trim()))
    .filter((cell) => cell.length > 0 && !headers.has(cell));
}
