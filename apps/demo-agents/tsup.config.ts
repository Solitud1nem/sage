import { defineConfig } from 'tsup';

// Independent entrypoints — Fly's [processes] tables start each one directly
// (`node dist/orchestrator/server.js` etc.), so we keep the directory layout
// instead of flat-bundling. `worker/server` is the generic multi-identity
// worker (M12.0.2, fly.workers.toml); the four single-identity workers stay
// until the first new pipeline passes e2e (ADR-0020 п.6).
export default defineConfig({
  entry: {
    'orchestrator/server': 'src/orchestrator/server.ts',
    'summarizer/agent': 'src/summarizer/agent.ts',
    'translator/agent': 'src/translator/agent.ts',
    'vision/agent': 'src/vision/agent.ts',
    'sentiment/agent': 'src/sentiment/agent.ts',
    'worker/server': 'src/worker/server.ts',
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
