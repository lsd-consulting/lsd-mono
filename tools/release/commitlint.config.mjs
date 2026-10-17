// Conventional commit messages (https://www.conventionalcommits.org): `type(scope)!: subject`.
// semantic-release reads them to decide each release (see docs/releasing.md). CI checks every
// pushed commit and each pull request's title (the squash-merge message) with this config.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Bodies and footers may carry long URLs or paths; only the header length is limited.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
}
