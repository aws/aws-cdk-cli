import type { github } from 'projen';

const IS_MERGE_QUEUE = "github.event_name == 'merge_group'";
const IS_MAIN_OR_MERGE_QUEUE = "github.ref == 'refs/heads/main' || github.event_name == 'merge_group'";

export const NX_CACHE_ENV = {
  NX_SKIP_NX_CACHE: `\${{ ${IS_MAIN_OR_MERGE_QUEUE} }}`,
};

export function nxCacheSteps(): github.workflows.JobStep[] {
  return [nxCacheRestoreStep(), nxCacheSaveStep()];
}

export function nxCacheRestoreStep(): github.workflows.JobStep {
  return {
    name: 'Restore NX cache',
    if: `\${{ !(${IS_MAIN_OR_MERGE_QUEUE}) }}`,
    uses: 'actions/cache/restore@v5',
    with: {
      'path': '.nx/cache',
      'key': 'nx-${{ github.sha }}',
      'restore-keys': 'nx-',
    },
  };
}

function nxCacheSaveStep(): github.workflows.JobStep {
  return {
    name: 'Save NX cache',
    if: `\${{ !(${IS_MERGE_QUEUE}) && always() }}`,
    uses: 'actions/cache/save@v5',
    with: {
      path: '.nx/cache',
      key: 'nx-${{ github.sha }}',
    },
  };
}
