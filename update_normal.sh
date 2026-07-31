#!/bin/bash

set -e
set -u

# 第一个参数作为 commit 注释，未传则默认 'u'
msg="${1:-u}"

git add -A

# 没有改动就跳过 commit
if git diff --cached --quiet; then
  echo "nothing to commit, skipping"
else
  git commit -m "$msg"
fi

git push
