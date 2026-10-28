#!/usr/bin/env bash
# Writes VERSION into every x.y.z version between the release-version markers in README.md.
# The release workflow runs it after a release (docs/releasing.md#the-readme-install-snippets).
# Usage: tools/release/update-readme-version.sh 0.16.0 [README.md]
set -euo pipefail
version="${1:?usage: $0 VERSION [README]}"
readme="${2:-README.md}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not an x.y.z version: $version" >&2; exit 1; }
start='<!-- release-version:start'
end='<!-- release-version:end -->'
[ "$(grep -c -F "$start" "$readme")" = 1 ] && [ "$(grep -c -F "$end" "$readme")" = 1 ] \
  || { echo "$readme needs exactly one release-version start and end marker" >&2; exit 1; }
VERSION="$version" perl -0pi -e '
  s{(<!-- release-version:start.*?<!-- release-version:end -->)}{
    my $block = $1; $block =~ s/\b\d+\.\d+\.\d+\b/$ENV{VERSION}/g; $block
  }se' "$readme"
