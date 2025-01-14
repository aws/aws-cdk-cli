#!/bin/bash
set -eu
scriptdir=$(cd $(dirname $0) && pwd)
target_repo=$(cd $scriptdir/.. && pwd)
source $scriptdir/move-helpers.bash

# Go
if [[ ! -d ../aws-cdk || ! -d ../cdk-assets || ! -d ../cloud-assembly-schema ]]; then
    echo "Not all directories are in the right locations!" >&2
    exit 1
fi

move_from_cdk() {
    move project "../aws-cdk" "$1" "packages/$2"
}

# RESET
begin

# COLLECT MOVES
move_from_cdk packages/aws-cdk aws-cdk
move_from_cdk packages/cdk cdk
# move_from_cdk packages/@aws-cdk/cx-api @aws-cdk/cx-api
move_from_cdk tools/@aws-cdk/node-bundle @aws-cdk/node-bundle
move_from_cdk tools/@aws-cdk/cdk-build-tools @aws-cdk/cdk-build-tools
move_from_cdk packages/@aws-cdk/cli-plugin-contract @aws-cdk/cli-plugin-contract
move_from_cdk packages/@aws-cdk/cli-lib-alpha @aws-cdk/cli-lib-alpha
move_from_cdk packages/@aws-cdk/cdk-cli-wrapper @aws-cdk/cdk-cli-wrapper
move_from_cdk packages/@aws-cdk/cloudformation-diff @aws-cdk/cloudformation-diff
move_from_cdk tools/@aws-cdk/yarn-cling @aws-cdk/yarn-cling
move_from_cdk tools/@aws-cdk/user-input-gen @aws-cdk/user-input-gen
move all ../aws-cdk tools/@aws-cdk/yarn-cling/test/test-fixture/ "packages/@aws-cdk/yarn-cling/test/test-fixture/"

move project ../cloud-assembly-schema "." "packages/@aws-cdk/cloud-assembly-schema"
move project ../cdk-assets "." "packages/cdk-assets"

# Remove the line containing 'test-fixture' from the "moves" file
cat move.tmp/repo.aws-cdk.moves | sed '/test-fixture/d' > move.tmp/repo.aws-cdk.moves.tmp
mv move.tmp/repo.aws-cdk.moves{.tmp,}
