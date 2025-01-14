movedir=$scriptdir/../move.tmp

slugify() {
  local input="$1"
  # Replace spaces, slashes, backslashes, dots, and other common path characters with underscore
  echo "$input" | sed 's/[ /\\.,:;]/_/g'
}

begin() {
    rm -rf $movedir
    mkdir -p $movedir

    # Make these files exist so we can execute them even if we never add any lines.
    echo 'set -eu' > $movedir/move-delete-original.sh
}

# Usage:
#   move <all|project> ../aws-cdk path/to/source path/to/target
move() {
    list_type="$1"
    source_root="$2"
    source_dir="$3"
    target_dir=$target_repo/$4

    echo "($source_root) $list_type $source_dir => $target_dir"

    # Need to group file paths per repo
    slug=$(basename $source_root)
    echo "$source_root" > $movedir/repo.$slug

    (cd $source_root && git checkout main && git reset --hard origin/main)

    $scriptdir/move-list-${list_type}.sh $source_root $source_dir >> $movedir/repo.$slug.paths

    # These are absolute paths
    echo "rm -rf $source_root/$source_dir" >> $movedir/move-delete-original.sh

    if [[ "$3" != "$4" ]]; then
        # This is relative to the current repo
        if [[ "$3" == "." ]]; then
            echo "mkdir -p $4" >> $movedir/repo.$slug.moves
            echo "git mv -k * $4" >> $movedir/repo.$slug.moves
        else
            echo "git mv $3 $4" >> $movedir/repo.$slug.moves
        fi
    fi
}

apply_moves() {
    echo "======> Prepare branches"
    for repofile in $movedir/repo.*; do
        if [[ "$repofile" == *.paths || "$repofile" == *.moves ]]; then
            continue
        fi

        slug=$(basename $(cat $repofile))
        branch=moved-$slug

        # Cut a branch from main, filter it down, then push it to the local target repo and merge it from there.
        # Then delete it again.
        #
        # In subshells for the 'cd'
        (
            echo "======> Moving $(cat $repofile)"
            set -x
            cd $(cat $repofile)

            git checkout -b $branch origin/main || git checkout $branch
            git reset --hard origin/main

            set -x
            git filter-repo --paths-from-file $repofile.paths --refs $branch --force

            if [[ -f $repofile.moves ]]; then
                /bin/bash $repofile.moves
                git commit -m 'chore: move packages to new locations'
            fi

            git remote add target $target_repo || git remote set-url target $target_repo
            git push target $branch --force

            # Check out 'main' again otherwise we're not allowed to delete it
            git checkout main
        )
    done

    echo "======> Merge branches"
    for repofile in $movedir/repo.*; do
        if [[ "$repofile" == *.paths || "$repofile" == *.moves ]]; then
            continue
        fi

        slug=$(basename $(cat $repofile))
        branch=moved-$slug

        (
            set -x
            cd $target_repo
            git merge $branch -m "chore: move original sources over" --allow-unrelated-histories
            git branch -D $branch
        )
    done
}

apply_deletes() {
    echo '------------------------------------------------------'
    echo '  APPLY DELETES'
    echo '------------------------------------------------------'
    (
        cd $1
        /bin/bash $movedir/move-delete-original.sh
        git commit -am 'chore: move packages out'
    )
}

apply_tags_from_npm() {
    echo '------------------------------------------------------'
    echo '  APPLY TAGS FROM NPM VERSIONS'
    echo '------------------------------------------------------'
    (
        cd $target_repo
        # Get some versions from NPM and apply their versions as tags
        # Set unknown packages to version 0.1.0 so projen doesn't fall into the "first release" workflow
        merge_base=$(git merge-base HEAD main)
        packages="$(cd packages && ls | grep -v @) $(cd packages && echo @*/*)"
        for package in $packages; do
            version=$(cd $TMPDIR && npm view $package version 2>/dev/null) || {
                version=0.1.0
            }
            echo "${package}@v${version}"
            git tag -f "${package}@v${version}" $merge_base
        done
    )
}
