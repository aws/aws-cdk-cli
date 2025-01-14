#!/bin/bash
# Parameters: <repo_root> <subdir>
set -eu

cd "$1"

if [[ "$2" == "." ]]; then
    fmt="%n"
else
    fmt="%f"
fi

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
    --exclude .github \
    --exclude .projen \
    --exclude .gitattributes \
    --exclude .eslintrc.json \
    --exclude .backportrc.json \
    --exclude .npmignore \
    --out-format="$fmt" \
    --dry-run \
    "$2" "/tmp"

# Also include .js files tracked by git in this directory
git ls-files "$2"'/**/*.js'