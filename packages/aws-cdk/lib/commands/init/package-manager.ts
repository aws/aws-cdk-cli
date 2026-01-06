export const JS_PACKAGE_MANAGERS = [
  { name: 'npm', commandPrefix: 'npm run' },
  { name: 'yarn', commandPrefix: 'yarn' },
  { name: 'pnpm', commandPrefix: 'pnpm' },
  { name: 'bun', commandPrefix: 'bun run' },
] as const;

export type JsPackageManager = (typeof JS_PACKAGE_MANAGERS)[number]['name'];

export const getPmCmdPrefix = (packageManager: JsPackageManager): string => {
  return JS_PACKAGE_MANAGERS.find(pm => pm.name === packageManager)!.commandPrefix;
};
