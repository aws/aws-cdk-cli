#!/bin/bash
# A bash script to watch the frontend source files and run the CDK explorer in a live mode where
# it refreshes frontend assets from the filesystem.
set -eu
scriptdir=$(cd $(dirname "$0") && pwd)
root=$(cd $scriptdir/../../../.. && pwd)

env CDK_LIVE=1 $root/node_modules/.bin/tsx $root/packages/aws-cdk/bin/cdk explore &
trap "pkill -P $$" EXIT

(cd $scriptdir/.. && $root/node_modules/.bin/tsx build-tools/bundle-frontend.ts --watch)
