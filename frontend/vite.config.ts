import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const frontendOrigin = new URL(env.FRONTEND_ORIGIN || "http://localhost:5173");
  return {
    plugins: [react()],
    server: {
      host: frontendOrigin.hostname,
      port: Number(frontendOrigin.port || 5173),
      strictPort: true,
      proxy: {
        "/api": {
          target: env.BACKEND_URL || "http://127.0.0.1:3001",
          changeOrigin: true,
        },
      },
    },
  };
});
