/**
 * Manual Jest mock for @clack/core.
 *
 * @clack/core is an ESM-only package that cannot be loaded by Jest in CJS mode.
 * Since prompt classes are interactive (stdin/stdout), they should always be mocked in tests.
 * Tests that need specific behavior should override these mocks with jest.mock().
 */

const mockPrompt = jest.fn().mockResolvedValue(undefined);

module.exports = {
  ConfirmPrompt: jest.fn().mockImplementation(() => ({ prompt: jest.fn().mockResolvedValue(true) })),
  TextPrompt: jest.fn().mockImplementation(() => ({ prompt: jest.fn().mockResolvedValue('') })),
  SelectPrompt: jest.fn().mockImplementation(() => ({ prompt: mockPrompt })),
  isCancel: jest.fn().mockReturnValue(false),
};
