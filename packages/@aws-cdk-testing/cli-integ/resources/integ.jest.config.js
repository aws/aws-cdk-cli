const path = require('path');
const os = require('os');

const rootDir = path.resolve(__dirname, '..', 'tests', process.env.TEST_SUITE_NAME);

if (rootDir.includes('node_modules')) {
  // Jest < 28 under no circumstances supports loading test if there's node_modules anywhere in the path,
  // and Jest >= 28 requires a newer TypeScript version than the one we support.
  throw new Error(`This package must not be 'npm install'ed (found node_modules in dir: ${rootDir})`);
}

module.exports = {
  rootDir,
  testMatch: [`**/*.integtest.js`],
  moduleFileExtensions: ["js"],

  testEnvironment: "node",

  // Because of the way Jest concurrency works, this timeout includes waiting
  // for the lock. Which is almost never what we actually care about. Set it high.
  testTimeout: 2 * 60 * 60_000,

  maxWorkers: maxWorkers(),
  reporters: [
    "default",
    ["jest-junit", { suiteName: "jest tests", outputDirectory: "coverage" }]
  ]
};

/**
 * Based on the machine spec, calcluate the maximum number of jest workers we can start in parallel.
 */
function maxWorkers() {

  const totalMachineMemoryMB = os.totalmem() / 1024 / 1024;
  const totalMachineCores = os.cpus().length;

  // empirically observed. this includes:
  // - 150 jest test process
  // - 140 app synthesis subprocess  
  // - 200 cli subprocess
  const maxWorkerMemoryMB = 500;

  // we take a factor of the total because not all 3 subprocess
  // consume their max theoretical memory at the same time.
  // 0.7 is an eyeballed factor that seems to work well.
  const averageWorkerMemoryMB = 0.7 * maxWorkerMemoryMB;

  // leave some memory for the OS and other external processes
  const reservedMemoryMB = 2000;

  // our processes don't take up much CPU so we allow for a large factor.
  const cpuScaleFactor = 15;

  const byMemory = Math.floor((totalMachineMemoryMB - reservedMemoryMB) / (averageWorkerMemoryMB));
  const byCpu = cpuScaleFactor * totalMachineCores;

  const maxWorkers = Math.min(byMemory, byCpu);
  console.log(`[integ.jest.config] calculated maxWorkers: ${maxWorkers}`)
  return maxWorkers;
}
