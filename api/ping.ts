/**
 * TEMPORARY DIAGNOSTIC — delete once it has answered its question.
 *
 * Every route of the real function has failed with FUNCTION_INVOCATION_FAILED
 * on every deployment so far, including `/api/health`, which touches no
 * configuration. The same code, bundled the way Vercel bundles it and imported
 * with no environment variables at all, answers correctly on this machine — so
 * the fault is not something reproducible locally.
 *
 * This file imports NOTHING. It shares only the runtime, the builder and the
 * routing with `api/index.ts`.
 *
 *   /api/ping works  -> runtime, builder and routing are fine; the fault is
 *                       inside the import graph of api/index.ts
 *   /api/ping fails  -> the fault is in how functions are built or invoked for
 *                       this project; nothing under server/ is implicated
 *
 * Reachable despite the `/api/(.*)` rewrite because Vercel matches filesystem
 * routes — static files and functions — before it applies rewrites.
 */
export default {
  // No parameter: Vercel compiles this file with a different `Request` type
  // than the local toolchain resolves, and `request.method` failed its build
  // while passing typecheck here. The probe never needed it.
  fetch() {
    return Response.json({
      pong: true,
      // Whether env vars reach a function at all, without revealing any value.
      // If these are false while the dashboard shows them set, the deployment
      // was created before they were added and needs redeploying.
      env: {
        DATABASE_URL: Boolean(process.env.DATABASE_URL),
        SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
        GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID),
        ALLOWED_EMAILS: Boolean(process.env.ALLOWED_EMAILS),
        VITE_GOOGLE_CLIENT_ID: Boolean(process.env.VITE_GOOGLE_CLIENT_ID),
      },
      node: process.version,
    })
  },
}
