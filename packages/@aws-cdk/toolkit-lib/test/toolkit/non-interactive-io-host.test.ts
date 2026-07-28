import type { IoRequest } from '../../lib/api/io';
import { NonInteractiveIoHost } from '../../lib/toolkit/non-interactive-io-host';

// In non-CI mode the host writes non-error output to stderr.
let stderrMock: jest.SpyInstance;

beforeEach(() => {
  stderrMock = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  stderrMock.mockRestore();
});

function request<U>(defaultResponse: U): IoRequest<undefined, U> {
  return {
    time: new Date(),
    level: 'info',
    action: 'deploy',
    code: 'CDK_TOOLKIT_I5060',
    message: 'Do you wish to deploy these changes?',
    data: undefined,
    defaultResponse,
  };
}

describe('requestResponse auto-answers with the default and surfaces it', () => {
  test('a true default is annotated as auto-confirmed', async () => {
    const host = new NonInteractiveIoHost({ isCI: false });

    const response = await host.requestResponse(request(true));

    expect(response).toBe(true);
    expect(stderrMock).toHaveBeenCalledWith(expect.stringContaining('Do you wish to deploy these changes? (auto-confirmed)'));
  });

  test('a false default is annotated as auto-denied', async () => {
    const host = new NonInteractiveIoHost({ isCI: false });

    const response = await host.requestResponse(request(false));

    expect(response).toBe(false);
    expect(stderrMock).toHaveBeenCalledWith(expect.stringContaining('Do you wish to deploy these changes? (auto-denied)'));
  });

  test('a non-boolean default reports the value it responded with', async () => {
    const host = new NonInteractiveIoHost({ isCI: false });

    const response = await host.requestResponse(request('the-default'));

    expect(response).toBe('the-default');
    expect(stderrMock).toHaveBeenCalledWith(expect.stringContaining('Do you wish to deploy these changes? (auto-responded with default: the-default)'));
  });
});
