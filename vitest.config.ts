// Root shim — re-export the real config from .config/ so vitest's auto-discovery
// (which checks cwd root for vitest.config.{ts,js}) finds it without requiring
// the `--config .config/vitest.config.ts` flag in every invocation.
//
// phase 246: prior to this shim, `pnpm vitest run` (no flag) and
// `pnpm test:run` (with flag) ran against different effective configs —
// the no-flag path missed the project split (fast + isolated) and
// globalSetup (auto-build dist for CLI smoke tests), producing
// misleading baseline numbers during the phase 220-224 measurement
// session (~100s wall, 4 file fail) vs the true configured-path
// numbers (~250-360s wall, 0 fail post phase 244+245).
//
// Package.json scripts continue to pass `--config .config/vitest.config.ts`
// explicitly so the intent stays self-documenting; both invocation styles
// are now equivalent.
export { default } from './.config/vitest.config.js';
