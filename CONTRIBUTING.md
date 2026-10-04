# Contributing

Start with a GitHub issue including problem, motivation, constraints and acceptance criteria. Fetch and branch from origin/main; never commit implementation directly to main. Use Conventional Commits. Run `pnpm build`, `pnpm tsc`, `pnpm lint`, `pnpm test --coverage`, and `pnpm audit --audit-level=high`; review audit findings. Format changed files with oxfmt. Push and open a PR with a Conventional Commit title and `Closes #<issue>`. Do not merge your own PR unless requested. Use Node 26 and pinned pnpm. Use git-dedup for Git operations.
