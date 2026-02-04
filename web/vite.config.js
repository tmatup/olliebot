import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const ReactCompilerConfig = {
  // Log which files get compiled (remove in production)
  logger: {
    logEvent(filename, event) {
      if (event.kind === 'CompileSuccess') {
        console.log(`[React Compiler] ✓ ${filename}`);
      } else if (event.kind === 'CompileError') {
        console.log(`[React Compiler] ✗ ${filename}: ${event.detail}`);
      }
    },
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useWsProxy = env.VITE_USE_WS_PROXY === 'true';

  // WebSocket proxy config (only used when VITE_USE_WS_PROXY=true)
  // Useful for remote development where only one port is forwarded
  const wsProxyConfig = useWsProxy ? {
    '/ws': {
      target: 'ws://localhost:3000',
      ws: true,
      rewrite: (path) => path.replace(/^\/ws/, ''),
    }
  } : {
    '/ws': {
      target: 'ws://localhost:3000',
      ws: true
    }
  };

  if (useWsProxy) {
    console.log('[vite] WebSocket proxy enabled (VITE_USE_WS_PROXY=true)');
  }

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', ReactCompilerConfig]],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        // Proxy API requests to backend
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        ...wsProxyConfig,
      },
      // HMR configuration for Windows compatibility
      watch: {
        usePolling: true,
        interval: 100,
      },
      hmr: {
        overlay: true,
      },
    },
  };
});
