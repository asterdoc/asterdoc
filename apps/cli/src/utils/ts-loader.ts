/**
 * Registers a TypeScript/JSX-aware ESM loader for this process, on demand.
 *
 * The built `asterdoc` binary is plain compiled JavaScript with no TypeScript
 * loader of its own, so importing a `.tsx`/`.jsx` module directly — binding
 * a composition's React layer, in `check.ts` today — fails with "Unknown
 * file extension". `tsx` exposes exactly this as a programmatic API:
 * `register()` installs Node's module hooks for the rest of the process, the
 * same hooks the `tsx` CLI installs for itself, so a plain dynamic
 * `import()` anywhere afterward — including one inside `@asterdoc/react`'s
 * own `bindComponent` — transforms a `.tsx`/`.jsx` file instead of failing
 * on its extension.
 *
 * `tsx` is not a dependency of `@asterdoc/cli`: it wraps esbuild, roughly 10 MB
 * that most `asterdoc` installs never touch. It is an optional peer, resolved at
 * the composition's project first and at `asterdoc`'s own installation second,
 * the way `asterdoc dev` resolves its bundler. A project with neither is told
 * what to install. Whichever copy registers, the hooks are process-wide.
 *
 * **The tsconfig has to be resolved explicitly.** Left to its own defaults,
 * `register()` resolves one from `process.cwd()`, which is wherever the
 * shell that ran `asterdoc` happens to be sitting rather than the composition's
 * own project — a composition checked from outside its project directory
 * would then transform under whatever `jsx` setting an unrelated tsconfig
 * that happens to govern the caller's cwd declares (or the classic
 * transform, with none at all), which fails at render with "React is not
 * defined" for a tree written against the automatic runtime. So this walks
 * up from the composition's own directory for its nearest `tsconfig.json`
 * and hands `register()` that path directly — and when none exists, passes
 * `tsconfig: false` explicitly rather than leaving the option unset, which
 * is what would let `register()` fall back to its own cwd-based search and
 * reintroduce exactly this leak.
 *
 * Registered once and cached: calling this more than once in a process is a
 * no-op, and a command that never binds a React layer never pays for it.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { importCheckLoader } from '../commands/dev/peers.js'

/** The slice of `tsx/esm/api` this needs. */
type Register = (options: { tsconfig: string | false }) => unknown

/** Walks up from `fromDir` for the nearest `tsconfig.json`, or `undefined` past the filesystem root. */
function findNearestTsconfig(fromDir: string): string | undefined {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'tsconfig.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

let registered = false

/**
 * `root` is the project the loader is resolved from; `fromDir` is where tsconfig
 * discovery starts — the composition's own directory.
 *
 * @throws {MissingPeerError} when neither the project nor `asterdoc` has `tsx`.
 */
export async function ensureTsLoader(root: string, fromDir: string): Promise<void> {
  if (registered) return
  const api = await importCheckLoader(root)
  // Resolved through `require`, so the CommonJS build may arrive under `default`.
  const register = (api.register ?? (api.default as { register?: unknown } | undefined)?.register) as Register
  const tsconfig = findNearestTsconfig(fromDir)
  register({ tsconfig: tsconfig ?? false })
  registered = true
}
