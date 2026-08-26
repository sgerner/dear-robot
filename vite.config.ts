/// <reference types="vitest" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5180,
    strictPort: false
  },
  // Skeleton Svelte ships its accessible primitives as source .svelte modules.
  // Keep them in Vite's Svelte pipeline for SSR and the production adapter build.
  ssr: {
    noExternal: ['@skeletonlabs/skeleton-svelte'],
    external: ['openai-codex-oauth']
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts']
  }
});
