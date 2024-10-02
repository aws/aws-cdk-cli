#!/bin/bash
set -eu

# Delete the source packages
FOR_REAL=false

# --quick: do copy, but don't delete
full=true
if [[ ${1:-} == "--quick" ]]; then
    full=false
fi

if [[ ! -d ../aws-cdk || ! -d ../cdk-assets || ! -d ../cloud-assembly-schema ]]; then
    echo "Not all directories are in the right locations!" >&2
    exit 1
fi


if $full; then
    git clean -qfdx packages
    mkdir -p packages/@aws-cdk
fi


move() {
    mkdir -p "$2"
    rsync -ah \
        --exclude ".git" \
        --exclude .projenrc.ts \
        --exclude node_modules \
        --exclude yarn.lock \
        --exclude /package.json \
        --exclude jest.config.js \
        --exclude tsconfig.\* \
        --exclude .gitignore \
        --exclude \*.d.ts \
        --exclude \*.js \
        --exclude .eslintrc.js \
        "$1/" "$2"
    if $FOR_REAL; then
        rm -rf "$2/*"
    fi
}

move_from_cdk() {
    move "../aws-cdk/$1" "packages/$2"
}

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
move_from_cdk tools/@aws-cdk/cli-args-gen @aws-cdk/cli-args-gen
rsync -ah ../aws-cdk/tools/@aws-cdk/yarn-cling/test/test-fixture/ "packages/@aws-cdk/yarn-cling/test/test-fixture/"

move ../cloud-assembly-schema "packages/@aws-cdk/cloud-assembly-schema"
move ../cdk-assets "packages/cdk-assets"

# Get some versions from NPM and apply their versions as tags
# Set non-NPM packages to version 0.1.0 so projen doesn't fall into the "first release" workflow
merge_base=$(git merge-base HEAD main)
packages="$(cd packages && ls | grep -v @) $(cd packages && echo @aws-cdk/*)"
for package in $packages; do
    version=$(cd $TMPDIR && npm view $package version 2>/dev/null) || {
        version=0.1.0
    }
    echo "${package}@v${version}"
    git tag -f "${package}@v${version}" $merge_base
done