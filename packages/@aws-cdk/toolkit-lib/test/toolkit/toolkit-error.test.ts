import { AssemblyError, AuthenticationError, ContextProviderError, NoResultsFoundError, ToolkitError } from '../../lib/toolkit/toolkit-error';

describe('toolkit error', () => {
  let toolkitError = new ToolkitError('Test toolkit error');
  let toolkitCauseError = ToolkitError.withCause('Test toolkit error', new Error('other error'));
  let authError = new AuthenticationError('Test authentication error');
  let contextProviderError = new ContextProviderError('Test context provider error');
  let assemblyError = AssemblyError.withStacks('Test authentication error', []);
  let assemblyCauseError = AssemblyError.withCause('Test authentication error', new Error('other error'));
  let noResultsError = new NoResultsFoundError('Test no results error');

  test('types are correctly assigned', async () => {
    expect(toolkitError.type).toBe('toolkit');
    expect(authError.type).toBe('authentication');
    expect(assemblyError.type).toBe('assembly');
    expect(assemblyCauseError.type).toBe('assembly');
    expect(contextProviderError.type).toBe('context-provider');
    expect(noResultsError.type).toBe('context-provider');
  });

  test('isToolkitError works', () => {
    expect(toolkitError.source).toBe('toolkit');

    expect(ToolkitError.isToolkitError(toolkitError)).toBe(true);
    expect(ToolkitError.isToolkitError(authError)).toBe(true);
    expect(ToolkitError.isToolkitError(assemblyError)).toBe(true);
    expect(ToolkitError.isToolkitError(assemblyCauseError)).toBe(true);
    expect(ToolkitError.isToolkitError(contextProviderError)).toBe(true);
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
});
