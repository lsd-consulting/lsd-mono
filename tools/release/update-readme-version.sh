#!/usr/bin/env bash
# Writes VERSION into every x.y.z version between the release-version markers, in every README that
# has them. The release workflow runs it after a release (docs/releasing.md#the-readme-install-snippets).
# Usage: tools/release/update-readme-version.sh 0.16.0 [FILE...]
# With no FILE it finds every tracked README.md and docs/*.md that has a start marker at the start of a line.
set -euo pipefail
version="${1:?usage: $0 VERSION [FILE...]}"
shift
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not an x.y.z version: $version" >&2; exit 1; }
start='<!-- release-version:start'
end='<!-- release-version:end -->'
files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  while IFS= read -r f; do files+=("$f"); done < <(
    git ls-files -- 'README.md' '**/README.md' 'docs/*.md' | xargs grep -l -- "^$start" | sort
  )
fi
[ ${#files[@]} -gt 0 ] || { echo "no file has a release-version marker" >&2; exit 1; }
for readme in "${files[@]}"; do
  [ "$(grep -c -- "^$start" "$readme")" = 1 ] && [ "$(grep -c -- "^$end" "$readme")" = 1 ] \
    || { echo "$readme needs exactly one release-version start and end marker" >&2; exit 1; }
done
for readme in "${files[@]}"; do
  VERSION="$version" perl -0pi -e '
    s{(<!-- release-version:start.*?<!-- release-version:end -->)}{
      my $block = $1; $block =~ s/\b\d+\.\d+\.\d+\b/$ENV{VERSION}/g; $block
    }se' "$readme"
  echo "$readme"
done
