#!/bin/bash
# Parameters: <repo_root> <subdir>
set -eu

if [[ "$2" == "." ]]; then
    fmt="%n"
else
    fmt="%f"
fi

cd "$1"
rsync -ah \
    --exclude ".git" \
    --out-format="$fmt" \
    --dry-run \
    "$2" "/tmp"

# Also include .js files tracked by git in this directory
git ls-files "$2"'/**/*.js'