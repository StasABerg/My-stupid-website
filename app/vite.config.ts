import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("@tanstack/react-query")) {
            return "tanstack";
          }
          if (id.includes("react-router")) {
            return "router";
          }
          if (id.includes("lucide-react")) {
            return "icons";
          }
          if (id.includes("@radix-ui")) {
            return "radix";
          }
          return "vendor";
        },
      },
    },
  },
}));
