import * as process from 'process';
import * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import type { IoHelper } from '../api-private';
import * as version from '../cli/version';

export async function doctor({ ioHelper }: { ioHelper: IoHelper }): Promise<number> {
  let exitStatus: number = 0;
  for (const verification of verifications) {
    if (!await verification(ioHelper)) {
      exitStatus = -1;
    }
  }
  await version.displayVersionMessage(ioHelper);
  return exitStatus;
}

const verifications: Array<(ioHelper: IoHelper) => boolean | Promise<boolean>> = [
  displayVersionInformation,
  displayAwsEnvironmentVariables,
  displayCdkEnvironmentVariables,
];

// ### Verifications ###

async function displayVersionInformation(ioHelper: IoHelper) {
  await ioHelper.defaults.info(`ℹ️ CDK Version: ${chalk.green(version.displayVersion())}`);
  return true;
}

async function displayAwsEnvironmentVariables(ioHelper: IoHelper) {
  const keys = Object.keys(process.env).filter(s => s.startsWith('AWS_'));
  if (keys.length === 0) {
    await ioHelper.defaults.info('ℹ️ No AWS environment variables');
    return true;
  }
  await ioHelper.defaults.info('ℹ️ AWS environment variables:');
  for (const key of keys) {
    await ioHelper.defaults.info(`  - ${chalk.blue(key)} = ${chalk.green(anonymizeAwsVariable(key, process.env[key]!))}`);
  }
  return true;
}

async function displayCdkEnvironmentVariables(ioHelper: IoHelper) {
  const keys = Object.keys(process.env).filter(s => s.startsWith('CDK_'));
  if (keys.length === 0) {
    await ioHelper.defaults.info('ℹ️ No CDK environment variables');
    return true;
  }
  await ioHelper.defaults.info('ℹ️ CDK environment variables:');
  let healthy = true;
  for (const key of keys.sort()) {
    if (key === cxapi.CONTEXT_ENV || key === cxapi.CONTEXT_OVERFLOW_LOCATION_ENV || key === cxapi.OUTDIR_ENV) {
      await ioHelper.defaults.info(`  - ${chalk.red(key)} = ${chalk.green(process.env[key]!)} (⚠️ reserved for use by the CDK toolkit)`);
      healthy = false;
    } else {
      await ioHelper.defaults.info(`  - ${chalk.blue(key)} = ${chalk.green(process.env[key]!)}`);
    }
  }
  return healthy;
}

function anonymizeAwsVariable(name: string, value: string) {
  if (name === 'AWS_ACCESS_KEY_ID') {
    return value.slice(0, 4) + '<redacted>';
  } // Show ASIA/AKIA key type, but hide identifier
  if (name === 'AWS_SECRET_ACCESS_KEY' || name === 'AWS_SESSION_TOKEN' || name === 'AWS_SECURITY_TOKEN') {
    return '<redacted>';
  }
  return value;
}
