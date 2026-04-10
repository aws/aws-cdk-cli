import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';

/**
 * Detect whether we are running on an EC2 instance by inspecting local system
 * metadata. This avoids the 1-2 second IMDS timeout on non-EC2 machines.
 *
 * Detection methods per platform (per AWS docs
 * https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/identify_ec2_instances.html):
 * - Linux: check DMI board_asset_tag for an EC2 instance ID, or hypervisor UUID for "ec2" prefix
 * - Windows: check DMI board_asset_tag via registry
 * - macOS and other platforms: assumed not EC2
 *
 * The result is cached for the lifetime of the process.
 */
let cachedIsEc2: boolean | undefined;
export function isEc2Instance(): boolean {
  if (cachedIsEc2 !== undefined) {
    return cachedIsEc2;
  }
  cachedIsEc2 = detectEc2();
  return cachedIsEc2;
}

function detectEc2(): boolean {
  // If the user has explicitly told us about IMDS, respect that
  if (process.env.AWS_EC2_METADATA_DISABLED !== undefined) {
    return process.env.AWS_EC2_METADATA_DISABLED === 'false';
  }

  const os = platform();
  try {
    if (os === 'linux') {
      return detectEc2Linux();
    }
    if (os === 'win32') {
      return detectEc2Windows();
    }
    // macOS and other platforms: not EC2
    // (EC2 Mac instances run on dedicated Mac minis with a Linux-based Nitro
    // hypervisor, but the guest OS sees itself as darwin. In practice these are
    // extremely rare for CDK CLI usage. If needed, this can be extended.)
    return false;
  } catch {
    // If detection fails, assume EC2. This makes us slightly slower but nothing
    // will unexpectedly break.
    return true;
  }
}

function detectEc2Linux(): boolean {
  // Nitro instances expose the instance ID as the board asset tag
  const boardAssetTag = '/sys/devices/virtual/dmi/id/board_asset_tag';
  if (existsSync(boardAssetTag)) {
    const tag = readFileSync(boardAssetTag, 'utf-8').trim();
    if (tag.startsWith('i-')) {
      return true;
    }
  }

  // Xen (PV) instances expose a UUID starting with "ec2" via the hypervisor
  const hypervisorUuid = '/sys/hypervisor/uuid';
  if (existsSync(hypervisorUuid)) {
    const uuid = readFileSync(hypervisorUuid, 'utf-8').trim().toLowerCase();
    if (uuid.startsWith('ec2')) {
      return true;
    }
  }

  return false;
}

function detectEc2Windows(): boolean {
  // On Windows EC2 instances the board asset tag is an instance ID, readable
  // from the registry without elevated privileges.
  const tag = execSync(
    'reg query "HKLM\\SYSTEM\\HardwareConfig\\Current" /v BaseBoardAssetTag 2>nul',
    { encoding: 'utf-8', timeout: 500 },
  ).trim();
  // Output contains "BaseBoardAssetTag    REG_SZ    i-0abc..."
  if (/i-[0-9a-f]+/i.test(tag)) {
    return true;
  }

  return false;
}
