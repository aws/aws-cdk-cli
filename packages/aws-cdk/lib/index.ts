// Polyfill util.styleText for Node.js <20.12 (used by @clack/prompts)
import './util/style-text-polyfill';

export * from './api';
export { cli, exec } from './cli/cli';
