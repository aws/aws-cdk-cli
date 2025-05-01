const path = require('path');

const rootDir = path.resolve(__dirname, '..', 'tests', process.env.TEST_SUITE_NAME);

module.exports = {
  rootDir,
  testMatch: [`**/*.integtest.js`],
  moduleFileExtensions: ["js"],

  testEnvironment: "node",

  // Because of the way Jest concurrency works, this timeout includes waiting
  // for the lock. Which is almost never what we actually care about. Set it high.
  testTimeout: 2 * 60 * 60_000,

  maxWorkers: 50,
  reporters: [
    "default",
    ["jest-junit", { suiteName: "jest tests", outputDirectory: "coverage" }]
  ],

  // Both of the following things are necessary to discover test files that are
  // potentially installed into `node_modules`.
  testPathIgnorePatterns: [],
  haste: {
    // Necessary to include files in 'node_modules' where we may be installed.
    retainAllFiles: true,
  },
};
