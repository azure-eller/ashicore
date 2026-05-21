import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: "https://ashicore.app",
  vite: {
    plugins: [tailwindcss()],
  },
});
