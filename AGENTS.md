# Notes for agents

- **Changelog.** Every user-visible commit carries its changelogger fragment in
  the same commit. Write it with the vendored script before committing:
  `python3 .changelog/changelogger.py new --type <added|changed|fixed|...> --text "..."`.
  Internal-only commits (refactors, tests, CI, tooling) use a `chore:`, `ci:`,
  `test:`, `docs:` or `refactor:` subject, or `python3 .changelog/changelogger.py skip <sha>`.
  `python3 .changelog/changelogger.py check --range origin/main..HEAD` is what
  the `changelog` check runs on pull requests.
- **Tests.** Any added or changed test goes through the test-gate skill: name
  the behavior it protects, the regression that makes it fail, why existing
  tests don't already catch it, and prove a regression test fails without the
  fix. Run `npm test` (and `npm run check` for page changes) before pushing.
- **Pruning tests.** Use the test-audit skill to review or prune existing tests.
- **Releases.** Agents never bump versions, compile the changelog, tag, or
  publish releases on their own. A person decides when to release.
