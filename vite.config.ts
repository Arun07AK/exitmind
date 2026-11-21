import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";

const webRoot = fileURLToPath(new URL("./web", import.meta.url));
const api = process.env.EXITMIND_API ?? "http://localhost:8080";

const rewriteSign: Connect.NextHandleFunction = (req, _res, next) => {
  if (req.url && /^\/sign(\/|\?|$)/.test(req.url)) req.url = req.url.replace(/^\/sign\/?/, "/sign.html");
  next();
};

const signRoute = (): Plugin => ({
  name: "exitmind-sign-route",
  configureServer(server) {
    server.middlewares.use(rewriteSign);
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewriteSign);
  },
});

export default defineConfig({
  root: webRoot,
  plugins: [react(), tailwindcss(), signRoute()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL("./web/index.html", import.meta.url)),
        sign: fileURLToPath(new URL("./web/sign.html", import.meta.url)),
      },
    },
  },
  server: {
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/ws": { target: api.replace(/^http/, "ws"), ws: true, changeOrigin: true },
    },
  },
});
