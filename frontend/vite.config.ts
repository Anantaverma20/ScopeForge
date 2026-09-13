import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.BACKEND_PORT ?? "8787";
  const frontendPort = Number(env.FRONTEND_PORT ?? 5273);
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: frontendPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: false,
        },
      },
    },
  };
});
