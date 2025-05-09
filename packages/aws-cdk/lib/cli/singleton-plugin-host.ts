/**
 * The singleton plugin host
 *
 * This is only a concept in the CLI, not in the toolkit library.
 */

import { PluginHost } from '../api/plugin';

export const GLOBAL_PLUGIN_HOST = new PluginHost();
