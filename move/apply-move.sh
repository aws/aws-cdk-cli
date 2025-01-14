#!/bin/bash
set -eu
scriptdir=$(cd $(dirname $0) && pwd)
target_repo=$(cd $scriptdir/.. && pwd)
source $scriptdir/move-helpers.bash

# Delete the source packages
FOR_REAL=false

git clean -fqdx packages/

# APPLY_MOVES
apply_moves

if $FOR_REAL; then
    apply_deletes
fi

apply_tags_from_npm

# Apply the right tag for the CLI to become 2.1000.0 on the next release
merge_base=$(git merge-base HEAD main)
git tag -f "aws-cdk@v2.999.0" $merge_base