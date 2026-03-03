import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      'process.env.DEEPSEEK_API_KEY': JSON.stringify(env.DEEPSEEK_API_KEY || ''),
      'process.env.DEEPSEEK_VL_MODEL': JSON.stringify(env.DEEPSEEK_VL_MODEL || ''),
      'process.env.DEEPSEEK_OCR_MODEL': JSON.stringify(env.DEEPSEEK_OCR_MODEL || '')
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true
        }
      }
    }
  };
});
