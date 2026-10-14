import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const key = env.OPENAI_API_KEY;
  // The dev and preview servers add the key to requests under /api/openai. The browser only learns whether a key is set.
  const proxy = key ? {
    '/api/openai': {
      target: 'https://api.openai.com',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/openai/, ''),
      headers: { Authorization: `Bearer ${key}` },
    },
  } : undefined;
  return {
    plugins: [react()],
    define: {
      __OPENAI_ENABLED__: JSON.stringify(Boolean(key)),
      __OPENAI_IMAGE_MODEL__: JSON.stringify(env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst'),
    },
    server: { proxy },
    preview: { proxy },
    test: { environment: 'node' },
  };
});
