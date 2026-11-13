import { resolveAgentMode } from '../../../lib/cli/util/agent-mode';

describe('resolveAgentMode', () => {
  test('is undefined when neither the flag nor CDK_AGENT is set', () => {
    expect(resolveAgentMode(['deploy'], undefined, {})).toBeUndefined();
  });

  test.each([
    [['deploy', '--agent'], true],
    [['--agent', 'synth'], true],
    [['diff', '--agent=true'], true],
    [['diff', '--no-agent'], false],
    [['diff', '--agent=false'], false],
  ])('the command line flag %p is used as parsed', (args, parsed) => {
    expect(resolveAgentMode(args, parsed, {})).toBe(parsed);
  });

  test.each(['1', 'true', 'TRUE', 'yes', 'kiro', ' 1 '])('CDK_AGENT=%p turns agentic mode on', (value) => {
    // yargs parses CDK_AGENT=1 as false; resolveAgentMode must not trust that
    expect(resolveAgentMode(['deploy'], false, { CDK_AGENT: value })).toBe(true);
  });

  test.each(['0', 'false', 'FALSE', 'no', 'off'])('CDK_AGENT=%p turns agentic mode off', (value) => {
    expect(resolveAgentMode(['deploy'], false, { CDK_AGENT: value })).toBe(false);
  });

  test('an empty CDK_AGENT counts as not set', () => {
    expect(resolveAgentMode(['deploy'], false, { CDK_AGENT: '' })).toBeUndefined();
  });

  test('--no-agent wins over CDK_AGENT=1', () => {
    expect(resolveAgentMode(['deploy', '--no-agent'], false, { CDK_AGENT: '1' })).toBe(false);
  });

  test('--agent wins over CDK_AGENT=0', () => {
    expect(resolveAgentMode(['deploy', '--agent'], true, { CDK_AGENT: '0' })).toBe(true);
  });

  test('arguments after -- are not treated as the flag', () => {
    expect(resolveAgentMode(['deploy', '--', '--agent'], true, { CDK_AGENT: '0' })).toBe(false);
  });
});
