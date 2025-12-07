export const JS_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'] as const;

export type JsPackageManager = (typeof JS_PACKAGE_MANAGERS)[number];
