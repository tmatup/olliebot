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
      target: 'ws://localhost:5173',
      ws: true,
      rewrite: (path) => path.replace(/^\/ws/, ''),
      configure: (proxy) => {
        // Suppress common WebSocket proxy errors (connection aborted/reset during refresh, tab close, HMR)
        const ignoredErrors = ['ECONNABORTED', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_WRITE_AFTER_END'];
        proxy.on('error', (err) => {
          if (!ignoredErrors.includes(err.code)) {
            console.error('[vite] ws proxy error:', err.message);
          }
        });
        proxy.on('proxyReqWs', (proxyReq, req, socket) => {
          socket.on('error', (err) => {
            if (!ignoredErrors.includes(err.code)) {
              console.error('[vite] ws proxy socket error:', err.message);
            }
          });
        });
        proxy.on('open', (proxySocket) => {
          proxySocket.on('error', (err) => {
            if (!ignoredErrors.includes(err.code)) {
              console.error('[vite] ws proxy outgoing socket error:', err.message);
            }
          });
        });
      },
    },
  } : {};

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
          target: 'http://localhost:5173',
          changeOrigin: true,
        },
        // WebSocket proxy (only when VITE_USE_WS_PROXY=true for remote dev)
        // By default, useWebSocket.js connects to port 5173
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
