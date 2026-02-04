#!/usr/bin/env node

const semver = require('semver');

const REQUIRED_NODE_VERSION = '20.20.0';

if (!semver.gte(process.version, REQUIRED_NODE_VERSION)) {
  console.error(`Node.js >= ${REQUIRED_NODE_VERSION} required for contributors (current: ${process.version})`);
  process.exit(1);
}
