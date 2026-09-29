import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import { relativeFileLocationRenderer, stripAnsi, ValidationReportFormatter } from '../lib/validations-formatter';

test('renders multiple source locations capped at 5', () => {
  const output = defaultFormatValidateReports([
    {
      conclusion: 'failure',
      pluginName: 'test-plugin',
      violations: [
        {
          severity: 'error',
          description: 'Test violation',
          ruleName: 'test-rule',
          violatingConstructs: [
            {
              constructPath: 'Stack/MyConstruct',
              stackTraces: [
                mkStackTrace('/root/src/file1.ts:10:20'),
                mkStackTrace('/root/src/file2.ts:10:20'),
                mkStackTrace('/root/src/file3.ts:10:20'),
                mkStackTrace('/root/src/file4.ts:10:20'),
                mkStackTrace('/root/src/file5.ts:10:20'),
                mkStackTrace('/root/src/file6.ts:10:20'),
              ],
            },
          ],
        },
      ],
    },
  ]);

  expect(stripAnsi(output)).toMatchInlineSnapshot(`
"src/file1.ts:10:20
or src/file2.ts:10:20
or src/file3.ts:10:20
or src/file4.ts:10:20
or src/file5.ts:10:20
(and 1 more...)
ERROR Test violation (test-plugin)
   Stack/MyConstruct
   Acknowledge with 'test-plugin::test-rule'"
`);
});

test('duplicate source locations are deduped', () => {
  const output = defaultFormatValidateReports([
    {
      conclusion: 'failure',
      pluginName: 'test-plugin',
      violations: [
        {
          severity: 'error',
          description: 'Test violation',
          ruleName: 'test-rule',
          violatingConstructs: [
            {
              constructPath: 'Stack/MyConstruct',
              stackTraces: [
                mkStackTrace('/root/src/file1.ts:10:20'),
                mkStackTrace('/root/src/file1.ts:10:20'),
                mkStackTrace('/root/src/file2.ts:10:20'),
                mkStackTrace('/root/src/file2.ts:10:20'),
                mkStackTrace('/root/src/file3.ts:10:20'),
                mkStackTrace('/root/src/file3.ts:10:20'),
              ],
            },
          ],
        },
      ],
    },
  ]);

  expect(stripAnsi(output)).toMatchInlineSnapshot(`
"src/file1.ts:10:20
or src/file2.ts:10:20
or src/file3.ts:10:20
ERROR Test violation (test-plugin)
   Stack/MyConstruct
   Acknowledge with 'test-plugin::test-rule'"
`);
});

function defaultFormatValidateReports(reports: PluginReportJson[]): string {
  return new ValidationReportFormatter({
    fileLocationRenderer: relativeFileLocationRenderer('/root'),
  }).formatReports(reports).join('\n');
}

function mkStackTrace(where: string): string {
  return `Error: Test violation\n    at MyConstruct (${where})\n    at Object.<anonymous> (/root/src/main.ts:15:20)`;
}
