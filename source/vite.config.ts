import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the whole app into one self-contained dist/index.html.
export default defineConfig({ base: "./", plugins: [viteSingleFile()] });
