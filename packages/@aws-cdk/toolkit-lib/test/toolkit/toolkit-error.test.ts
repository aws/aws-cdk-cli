import { AssemblyError, AuthenticationError, BootstrapError, ContextProviderError, NoResultsFoundError, ToolkitError } from '../../lib/toolkit/toolkit-error';

describe('toolkit error', () => {
  let toolkitError = new ToolkitError('Test toolkit error');
  let toolkitCauseError = ToolkitError.withCause('Test toolkit error', new Error('other error'));
  let authError = new AuthenticationError('Test authentication error');
  let contextProviderError = new ContextProviderError('Test context provider error');
  let assemblyError = AssemblyError.withStacks('Test authentication error', []);
  let assemblyCauseError = AssemblyError.withCause('Test authentication error', new Error('other error'));
  let noResultsError = new NoResultsFoundError('Test no results error');
  let bootstrapError = new BootstrapError('Test bootstrap error', { account: '123456789012', region: 'us-east-1' });
  let bootstrapErrorWithCause = new BootstrapError('Test bootstrap error with cause', { account: '987654321098', region: 'eu-west-1' }, new Error('underlying cause'));

  test('types are correctly assigned', async () => {
    expect(toolkitError.type).toBe('toolkit');
    expect(authError.type).toBe('authentication');
    expect(assemblyError.type).toBe('assembly');
    expect(assemblyCauseError.type).toBe('assembly');
    expect(contextProviderError.type).toBe('context-provider');
    expect(noResultsError.type).toBe('context-provider');
    expect(bootstrapError.type).toBe('bootstrap');
    expect(bootstrapErrorWithCause.type).toBe('bootstrap');
  });

  test('isToolkitError works', () => {
    expect(toolkitError.source).toBe('toolkit');

    expect(ToolkitError.isToolkitError(toolkitError)).toBe(true);
    expect(ToolkitError.isToolkitError(authError)).toBe(true);
    expect(ToolkitError.isToolkitError(assemblyError)).toBe(true);
    expect(ToolkitError.isToolkitError(assemblyCauseError)).toBe(true);
    expect(ToolkitError.isToolkitError(contextProviderError)).toBe(true);
    expect(ToolkitError.isToolkitError(bootstrapError)).toBe(true);
    expect(ToolkitError.isToolkitError(bootstrapErrorWithCause)).toBe(true);
  });

  test('ToolkitError.withCause', () => {
    expect((toolkitCauseError.cause as any)?.message).toBe('other error');
    expect(ToolkitError.isToolkitError(toolkitCauseError)).toBe(true);
  });

  test('isAuthenticationError works', () => {
    expect(authError.source).toBe('user');

    expect(ToolkitError.isAuthenticationError(toolkitError)).toBe(false);
    expect(ToolkitError.isAuthenticationError(authError)).toBe(true);
  });

  describe('isAssemblyError works', () => {
    test('AssemblyError.fromStacks', () => {
      expect(assemblyError.source).toBe('user');
      expect(assemblyError.stacks).toStrictEqual([]);

      expect(ToolkitError.isAssemblyError(assemblyError)).toBe(true);
      expect(ToolkitError.isAssemblyError(toolkitError)).toBe(false);
      expect(ToolkitError.isAssemblyError(authError)).toBe(false);
    });

    test('AssemblyError.withCause', () => {
      expect(assemblyCauseError.source).toBe('user');
      expect((assemblyCauseError.cause as any)?.message).toBe('other error');

      expect(ToolkitError.isAssemblyError(assemblyCauseError)).toBe(true);
      expect(ToolkitError.isAssemblyError(toolkitError)).toBe(false);
      expect(ToolkitError.isAssemblyError(authError)).toBe(false);
    });
  });

  test('isContextProviderError works', () => {
    expect(contextProviderError.source).toBe('user');

    expect(ToolkitError.isContextProviderError(contextProviderError)).toBe(true);
    expect(ToolkitError.isContextProviderError(noResultsError)).toBe(true);
    expect(ToolkitError.isContextProviderError(toolkitError)).toBe(false);
    expect(ToolkitError.isContextProviderError(authError)).toBe(false);
  });

  test('NoResultsFoundError works', () => {
    expect(noResultsError.source).toBe('user');

    expect(ContextProviderError.isNoResultsFoundError(noResultsError)).toBe(true);
    expect(ToolkitError.isContextProviderError(noResultsError)).toBe(true);
    expect(ToolkitError.isToolkitError(noResultsError)).toBe(true);

    expect(ToolkitError.isAssemblyError(noResultsError)).toBe(false);
    expect(ToolkitError.isAuthenticationError(noResultsError)).toBe(false);
  });

  describe('BootstrapError', () => {
    test('constructor creates error with correct properties', () => {
      const error = new BootstrapError('Bootstrap stack not found', { account: '111122223333', region: 'ap-southeast-1' });

      expect(error.message).toBe('Bootstrap stack not found');
      expect(error.type).toBe('bootstrap');
      expect(error.source).toBe('user');
      expect(error.environment).toEqual({ account: '111122223333', region: 'ap-southeast-1' });
      expect(error.name).toBe('BootstrapError');
    });

    test('constructor with cause preserves cause', () => {
      const cause = new Error('underlying error');
      const error = new BootstrapError('Bootstrap failed', { account: '123456789012', region: 'us-west-2' }, cause);

      expect(error.cause).toBe(cause);
      expect((error.cause as Error).message).toBe('underlying error');
    });

    test('environment property contains account and region', () => {
      expect(bootstrapError.environment.account).toBe('123456789012');
      expect(bootstrapError.environment.region).toBe('us-east-1');

      expect(bootstrapErrorWithCause.environment.account).toBe('987654321098');
      expect(bootstrapErrorWithCause.environment.region).toBe('eu-west-1');
    });

    test('inherits from ToolkitError (instanceof)', () => {
      expect(bootstrapError instanceof ToolkitError).toBe(true);
      expect(bootstrapError instanceof Error).toBe(true);
      expect(bootstrapErrorWithCause instanceof ToolkitError).toBe(true);
    });

    test('isBootstrapError type guard returns true for BootstrapError', () => {
      expect(ToolkitError.isBootstrapError(bootstrapError)).toBe(true);
      expect(ToolkitError.isBootstrapError(bootstrapErrorWithCause)).toBe(true);
    });

    test('isBootstrapError returns false for other ToolkitError types', () => {
      expect(ToolkitError.isBootstrapError(toolkitError)).toBe(false);
      expect(ToolkitError.isBootstrapError(authError)).toBe(false);
      expect(ToolkitError.isBootstrapError(assemblyError)).toBe(false);
      expect(ToolkitError.isBootstrapError(assemblyCauseError)).toBe(false);
      expect(ToolkitError.isBootstrapError(contextProviderError)).toBe(false);
      expect(ToolkitError.isBootstrapError(noResultsError)).toBe(false);
    });

    test('isBootstrapError returns false for non-ToolkitError types', () => {
      expect(ToolkitError.isBootstrapError(new Error('plain error'))).toBe(false);
      expect(ToolkitError.isBootstrapError(null)).toBe(false);
      expect(ToolkitError.isBootstrapError(undefined)).toBe(false);
      expect(ToolkitError.isBootstrapError('string error')).toBe(false);
      expect(ToolkitError.isBootstrapError(42)).toBe(false);
      expect(ToolkitError.isBootstrapError({ message: 'fake error' })).toBe(false);
    });

    test('isToolkitError returns true for BootstrapError', () => {
      expect(ToolkitError.isToolkitError(bootstrapError)).toBe(true);
      expect(ToolkitError.isToolkitError(bootstrapErrorWithCause)).toBe(true);
    });

    test('other type guards return false for BootstrapError', () => {
      expect(ToolkitError.isAuthenticationError(bootstrapError)).toBe(false);
      expect(ToolkitError.isAssemblyError(bootstrapError)).toBe(false);
      expect(ToolkitError.isContextProviderError(bootstrapError)).toBe(false);
    });
  });
});
