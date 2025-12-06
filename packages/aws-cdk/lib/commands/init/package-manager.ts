export const JS_PACKAGE_MANAGER = {
  NPM: 'npm',
  YARN: 'yarn',
  PNPM: 'pnpm',
} as const;

export type JsPackageManager = typeof JS_PACKAGE_MANAGER[keyof typeof JS_PACKAGE_MANAGER];