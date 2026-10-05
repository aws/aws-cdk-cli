#!/bin/bash
# A bash script to rebuild the static assets and restart the server
set -eu
scriptdir=$(cd $(dirname "$0") && pwd)
root=$(cd $scriptdir/../../../.. && pwd)

env CDK_LIVE=1 $root/node_modules/.bin/ts-node --transpileOnly --preferTsExts $root/packages/aws-cdk/bin/cdk explore &
trap "pkill -P $$" EXIT

(cd $scriptdir/.. && $root/node_modules/.bin/ts-node --transpileOnly --preferTsExts build-tools/bundle-frontend.ts --watch)
