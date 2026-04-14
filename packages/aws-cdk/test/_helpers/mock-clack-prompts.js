/**
 * Manual Jest mock for @clack/prompts.
 *
 * @clack/prompts is an ESM-only package that cannot be loaded by Jest in CJS mode.
 * Since prompt functions are interactive (stdin/stdout), they should always be mocked in tests.
 * Tests that need specific behavior should override these mocks with jest.mock() or jest.spyOn().
 */
module.exports = {
  confirm: jest.fn().mockResolvedValue(true),
  text: jest.fn().mockResolvedValue(''),
  select: jest.fn().mockResolvedValue(undefined),
  isCancel: jest.fn().mockReturnValue(false),
};
