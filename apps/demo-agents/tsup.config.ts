import { defineConfig } from 'tsup';

// Three independent entrypoints — Fly's [processes] table starts each one
// directly (`node dist/orchestrator/server.js` etc.), so we keep the
// directory layout instead of flat-bundling.
export default defineConfig({
  entry: {
    'orchestrator/server': 'src/orchestrator/server.ts',
    'summarizer/agent': 'src/summarizer/agent.ts',
    'translator/agent': 'src/translator/agent.ts',
    'vision/agent': 'src/vision/agent.ts',
    'sentiment/agent': 'src/sentiment/agent.ts',
  },
  format: 'esm',
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  dts: false,
});
