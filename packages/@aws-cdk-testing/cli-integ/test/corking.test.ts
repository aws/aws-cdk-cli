import { MemoryStream, redactSecrets, registerSecrets } from '../lib/corking';

// The secret registry is process-global and has no deregistration, so use a value unique
// to this file. That keeps these cases independent of each other and of other test files,
// which matters because the suite runs in randomized order.
const SECRET = 'FwoGZXIvYXdzEBYaCORKINGTESTTOKEN';

registerSecrets(SECRET);

describe('redactSecrets', () => {
  test('replaces a registered secret', () => {
    expect(redactSecrets(`AWS_SESSION_TOKEN=${SECRET}`)).toEqual('AWS_SESSION_TOKEN=<REDACTED>');
  });

  test('replaces every occurrence, not just the first', () => {
    expect(redactSecrets(`${SECRET} and ${SECRET}`)).toEqual('<REDACTED> and <REDACTED>');
  });

  test('leaves unregistered text alone', () => {
    expect(redactSecrets('nothing to see here')).toEqual('nothing to see here');
  });
});

describe('MemoryStream', () => {
  test('redacts secrets from buffered output', () => {
    const stream = new MemoryStream();
    stream.write(`+ env AWS_SECRET_ACCESS_KEY=${SECRET} cdk deploy\n`);

    expect(stream.toString()).toEqual('+ env AWS_SECRET_ACCESS_KEY=<REDACTED> cdk deploy\n');
  });

  test('redacts a secret split across two writes', () => {
    // Subprocess output arrives in arbitrarily-sized chunks, so a secret can straddle them.
    const stream = new MemoryStream();
    const half = Math.floor(SECRET.length / 2);
    stream.write(SECRET.substring(0, half));
    stream.write(SECRET.substring(half));

    expect(stream.toString()).toEqual('<REDACTED>');
  });

  test('preserves non-secret output verbatim', () => {
    const stream = new MemoryStream();
    stream.write('hello ');
    stream.write('world');

    expect(stream.toString()).toEqual('hello world');
  });

  test('flushTo writes redacted output', async () => {
    const stream = new MemoryStream();
    stream.write(`token=${SECRET}`);

    const target = new MemoryStream();
    await stream.flushTo(target);

    expect(target.toString()).toEqual('token=<REDACTED>');
  });
});
