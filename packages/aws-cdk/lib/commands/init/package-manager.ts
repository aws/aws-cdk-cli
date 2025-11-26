export const JS_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm'] as const;

export type JsPackageManager = typeof JS_PACKAGE_MANAGERS[number];
