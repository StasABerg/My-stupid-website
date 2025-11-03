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

          const matchers: Array<{ test: (value: string) => boolean; name: string }> = [
            { test: (value) => value.includes("react-dom") || value.includes("scheduler"), name: "react-dom" },
            { test: (value) => value.includes("/react/") || /react\/index\.js$/.test(value), name: "react" },
            { test: (value) => value.includes("react-router"), name: "router" },
            { test: (value) => value.includes("@tanstack/react-query"), name: "tanstack" },
            { test: (value) => value.includes("@radix-ui"), name: "radix" },
            { test: (value) => value.includes("lucide-react"), name: "icons" },
            { test: (value) => value.includes("sonner"), name: "sonner" },
            { test: (value) => value.includes("cmdk"), name: "command" },
            { test: (value) => value.includes("react-hook-form") || value.includes("@hookform"), name: "react-hook-form" },
            { test: (value) => value.includes("react-day-picker"), name: "react-day-picker" },
            { test: (value) => value.includes("date-fns"), name: "date-fns" },
            { test: (value) => value.includes("zod"), name: "zod" },
            { test: (value) => value.includes("hls.js"), name: "hls" },
            { test: (value) => value.includes("swagger-ui"), name: "swagger" },
            { test: (value) => value.includes("embla-carousel"), name: "carousel" },
            { test: (value) => value.includes("recharts"), name: "recharts" },
          ];

          for (const matcher of matchers) {
            if (matcher.test(id)) {
              return matcher.name;
            }
          }

          return "vendor";
        },
      },
    },
  },
}));
