import { build } from "esbuild";

await build({
  entryPoints: ["src/index.tsx"],
  outfile: "dist/render.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  jsx: "automatic",
  loader: { ".tsx": "tsx", ".ts": "ts" },
  banner: {
    js: "import { createRequire as __octosyncCreateRequire } from 'node:module';\nconst require = __octosyncCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});
