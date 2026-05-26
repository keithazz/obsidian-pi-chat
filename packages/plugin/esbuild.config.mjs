import esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "dist");
const watch = process.argv.includes("--watch");

await mkdir(distDir, { recursive: true });
await cp(resolve(__dirname, "manifest.json"), resolve(distDir, "manifest.json"));
await cp(resolve(__dirname, "styles.css"), resolve(distDir, "styles.css"));

const copyStaticPlugin = {
  name: "copy-static",
  setup(build) {
    build.onEnd(async () => {
      await cp(resolve(__dirname, "manifest.json"), resolve(distDir, "manifest.json"));
      await cp(resolve(__dirname, "styles.css"), resolve(distDir, "styles.css"));
    });
  },
};

const options = {
  entryPoints: [resolve(__dirname, "src/main.ts")],
  outfile: resolve(distDir, "main.js"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2020",
  external: ["obsidian", "electron"],
  logLevel: "info",
  plugins: [copyStaticPlugin],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[plugin] watching for changes...");
} else {
  await esbuild.build(options);
}
