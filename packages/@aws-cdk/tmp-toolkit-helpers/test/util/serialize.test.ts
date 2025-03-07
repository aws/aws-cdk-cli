import { toYAML, obscureTemplate, replacerBufferWithInfo } from '../../src/util/serialize';

describe(toYAML, () => {
  test('does not wrap lines', () => {
    const longString = 'Long string is long!'.repeat(1_024);
    expect(toYAML({ longString })).toEqual(`longString: ${longString}\n`);
  });
});

describe(obscureTemplate, () => {
  test('removes CheckBootstrapVersion rule only', () => {
    const template = {
      Rules: {
        CheckBootstrapVersion: { Assertions: [{ AssertDescription: 'bootstrap' }] },
        MyOtherRule: { Assertions: [{ AssertDescription: 'other' }] },
      },
    };

    const obscured = obscureTemplate(template);
    expect(obscured).not.toHaveProperty('Rules.CheckBootstrapVersion');
    expect(obscured).toHaveProperty('Rules.MyOtherRule.Assertions.0.AssertDescription', 'other');
  });

  test('removes all rules when CheckBootstrapVersion is the only rule', () => {
    const template = {
      Rules: {
        CheckBootstrapVersion: { Assertions: [{ AssertDescription: 'bootstrap' }] },
      },
    };

    const obscured = obscureTemplate(template);
    expect(obscured).not.toHaveProperty('Rules.CheckBootstrapVersion');
    expect(obscured).not.toHaveProperty('Rules');
  });
});
test('converts buffer to information', () => {
  const res = JSON.stringify({ data: Buffer.from('test data') }, replacerBufferWithInfo);

  expect(res).toEqual('{"data":"<Buffer: 9 Bytes>"}');
});

