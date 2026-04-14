# otelop Development Guidelines

## Project Overview

A local-development tool for visualizing OpenTelemetry signals (Traces / Metrics / Logs) in the browser in real time.

## Development Commands

```bash
mise run dev      # Start the dev server
mise run check    # Format, lint, type-check
mise run test     # Run Go + frontend tests
mise run build    # Build
```

## Backend

- Go + OpenTelemetry Collector (embedded)
- lint: `golangci-lint run ./...`
- Auto-format: `golangci-lint fmt ./...`
- Tests: `go test ./...`
- Tests live in `internal/store/` and `internal/websocket/`

## Frontend

- Uses vite-plus (vp). Run commands via package.json scripts
- Auto-format: `pnpm --filter otelop-frontend fix`
- Tests: `pnpm --filter otelop-frontend test`
- Test helpers are consolidated in `frontend/src/test/factories.ts`

## Coding Conventions

### CSS / Styling

- Use shadcn semantic colors (`bg-muted`, `text-foreground`, etc.). Avoid arbitrary opacity like `bg-foreground/[0.03]`
- Verify both light and dark mode. Light mode is easy to overlook
- `glass-card` is the card background. In light mode it shifts toward white (the main content is brighter than its surroundings)
- shadcn component default styles can override custom styles via the `dark:` prefix. Add `dark:` overrides as needed

### React / State Management

- Don't call `setState` inside `useEffect`. Handle it directly in event handlers
- For `useRef` timers, `clearTimeout` in the `useEffect` cleanup on unmount
- Extract duplicated patterns into factory functions or components (e.g. `createSearchAtom`, `CopyJsonButton`)
- Before creating a new UI component, check whether shadcn already provides one

### Timestamps

- Use `Temporal.Instant.from(...)` (from `temporal-polyfill`) for parsing/comparing OTel timestamps. `Date.parse` truncates to milliseconds and loses the nanosecond precision that OTel emits

### Comments

- WHAT comments (`{/* Bar */}`, `{/* Operation name */}`) are unnecessary — the code is self-evident
- Keep only WHY comments (why this implementation)

## Workflow

- Don't commit until the user gives permission
- Always run `mise run check` and `mise run test` after making changes
- Use agent-browser to verify both light and dark mode

### Commit messages and PR titles

Releases are cut by [release-please](https://github.com/googleapis/release-please), so commit messages and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/). release-please parses these to derive the next version and generate the changelog.

- Format: `type(scope): subject` (e.g. `fix(collector): normalize confmap values for static provider`)
- Common types: `feat` (minor bump), `fix` (patch bump), `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`
- Use `!` or a `BREAKING CHANGE:` footer for breaking changes (major bump)
- Scope is optional but encouraged — match existing scopes in `git log` (e.g. `collector`, `cli`, `proxy`, `frontend`, `store`, `deps`)
- Squash-merge PRs inherit the PR title as the commit, so the PR title must follow the same rules
