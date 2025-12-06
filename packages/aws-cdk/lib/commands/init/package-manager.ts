export const JS_PACKAGE_MANAGER = {
  NPM: 'npm',
  YARN: 'yarn',
  PNPM: 'pnpm',
  BUN: 'bun',
} as const;

export type JsPackageManager = typeof JS_PACKAGE_MANAGER[keyof typeof JS_PACKAGE_MANAGER];