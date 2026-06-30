// vite.config.ts
import { resolve } from "path";
import { defineConfig } from "file:///D:/Code/siyuan-plugin-copilot/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.37_sass@1.98.0/node_modules/vite/dist/node/index.js";
import { viteStaticCopy } from "file:///D:/Code/siyuan-plugin-copilot/node_modules/.pnpm/vite-plugin-static-copy@1.0.6_vite@5.4.21/node_modules/vite-plugin-static-copy/dist/index.js";
import { svelte } from "file:///D:/Code/siyuan-plugin-copilot/node_modules/.pnpm/@sveltejs+vite-plugin-svelte@3.1.2_svelte@4.2.20_vite@5.4.21/node_modules/@sveltejs/vite-plugin-svelte/src/index.js";
import zipPack from "file:///D:/Code/siyuan-plugin-copilot/node_modules/.pnpm/vite-plugin-zip-pack@1.2.4_vite@5.4.21/node_modules/vite-plugin-zip-pack/dist/esm/index.mjs";
import fg from "file:///D:/Code/siyuan-plugin-copilot/node_modules/.pnpm/fast-glob@3.3.3/node_modules/fast-glob/out/index.js";
import { execSync } from "child_process";
var __vite_injected_original_dirname = "D:\\Code\\siyuan-plugin-copilot";
var env = process.env;
var isSrcmap = env.VITE_SOURCEMAP === "inline";
var isDev = env.NODE_ENV === "development";
var outputDir = isDev ? "dev" : "dist";
console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);
var vite_config_default = defineConfig({
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "src")
    }
  },
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        { src: "./README*.md", dest: "./" },
        { src: "./CHANGELOG.md", dest: "./" },
        { src: "./plugin.json", dest: "./" },
        { src: "./preview.png", dest: "./" },
        { src: "./icon.png", dest: "./" },
        { src: "./assets/*", dest: "./assets/" },
        { src: "./i18n/*", dest: "./i18n/" },
        { src: "./src/tools/skills/*.md", dest: "./skills/" }
      ]
    }),
    // Auto copy to SiYuan plugins directory in dev mode
    ...isDev ? [
      {
        name: "auto-copy-to-siyuan",
        writeBundle() {
          try {
            execSync("node --no-warnings ./scripts/make_dev_copy.js", {
              stdio: "inherit",
              cwd: process.cwd()
            });
          } catch (error) {
            console.warn("Auto copy to SiYuan failed:", error.message);
            console.warn("You can manually run: pnpm run make-link-win");
          }
        }
      }
    ] : []
  ],
  define: {
    "process.env.DEV_MODE": JSON.stringify(isDev),
    "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
  },
  build: {
    outDir: outputDir,
    // Keep existing files in output directory for incremental builds
    emptyOutDir: false,
    minify: true,
    sourcemap: isSrcmap ? "inline" : false,
    lib: {
      entry: resolve(__vite_injected_original_dirname, "src/index.ts"),
      fileName: "index",
      formats: ["cjs"]
    },
    rollupOptions: {
      plugins: [
        ...isDev ? [
          {
            name: "watch-external",
            async buildStart() {
              const files = await fg([
                "./i18n/**",
                "./src/tools/skills/**",
                "./README*.md",
                "./CHANGELOG.md",
                "./plugin.json"
              ]);
              for (let file of files) {
                this.addWatchFile(file);
              }
            }
          }
        ] : [
          // Clean up unnecessary files under dist dir
          cleanupDistFiles({
            patterns: ["i18n/*.yaml", "i18n/*.md"],
            distDir: outputDir
          }),
          zipPack({
            inDir: "./dist",
            outDir: "./",
            outFileName: "package.zip"
          })
        ]
      ],
      external: ["siyuan", "process"],
      output: {
        entryFileNames: "[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css") {
            return "index.css";
          }
          return assetInfo.name;
        },
        // 禁用代码分割，将所有代码打包到单个文件中
        manualChunks: void 0,
        inlineDynamicImports: true
      }
    }
  }
});
function cleanupDistFiles(options) {
  const {
    patterns,
    distDir
  } = options;
  return {
    name: "rollup-plugin-cleanup",
    enforce: "post",
    writeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        const fg2 = await import("file:///D:/Code/siyuan-plugin-copilot/node_modules/.pnpm/fast-glob@3.3.3/node_modules/fast-glob/out/index.js");
        const fs = await import("fs");
        const distPatterns = patterns.map((pat) => `${distDir}/${pat}`);
        console.debug("Cleanup searching patterns:", distPatterns);
        const files = await fg2.default(distPatterns, {
          dot: true,
          absolute: true,
          onlyFiles: false
        });
        for (const file of files) {
          try {
            if (fs.default.existsSync(file)) {
              const stat = fs.default.statSync(file);
              if (stat.isDirectory()) {
                fs.default.rmSync(file, { recursive: true });
              } else {
                fs.default.unlinkSync(file);
              }
              console.log(`Cleaned up: ${file}`);
            }
          } catch (error) {
            console.error(`Failed to clean up ${file}:`, error);
          }
        }
      }
    }
  };
}
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxDb2RlXFxcXHNpeXVhbi1wbHVnaW4tY29waWxvdFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcQ29kZVxcXFxzaXl1YW4tcGx1Z2luLWNvcGlsb3RcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L0NvZGUvc2l5dWFuLXBsdWdpbi1jb3BpbG90L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJwYXRoXCJcclxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSBcInZpdGVcIlxyXG5pbXBvcnQgeyB2aXRlU3RhdGljQ29weSB9IGZyb20gXCJ2aXRlLXBsdWdpbi1zdGF0aWMtY29weVwiXHJcbmltcG9ydCBsaXZlcmVsb2FkIGZyb20gXCJyb2xsdXAtcGx1Z2luLWxpdmVyZWxvYWRcIlxyXG5pbXBvcnQgeyBzdmVsdGUgfSBmcm9tIFwiQHN2ZWx0ZWpzL3ZpdGUtcGx1Z2luLXN2ZWx0ZVwiXHJcbmltcG9ydCB6aXBQYWNrIGZyb20gXCJ2aXRlLXBsdWdpbi16aXAtcGFja1wiO1xyXG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcclxuaW1wb3J0IGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcclxuXHJcblxyXG5jb25zdCBlbnYgPSBwcm9jZXNzLmVudjtcclxuY29uc3QgaXNTcmNtYXAgPSBlbnYuVklURV9TT1VSQ0VNQVAgPT09ICdpbmxpbmUnO1xyXG5jb25zdCBpc0RldiA9IGVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JztcclxuXHJcbmNvbnN0IG91dHB1dERpciA9IGlzRGV2ID8gXCJkZXZcIiA6IFwiZGlzdFwiO1xyXG5cclxuY29uc29sZS5sb2coXCJpc0Rldj0+XCIsIGlzRGV2KTtcclxuY29uc29sZS5sb2coXCJpc1NyY21hcD0+XCIsIGlzU3JjbWFwKTtcclxuY29uc29sZS5sb2coXCJvdXRwdXREaXI9PlwiLCBvdXRwdXREaXIpO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICAgIHJlc29sdmU6IHtcclxuICAgICAgICBhbGlhczoge1xyXG4gICAgICAgICAgICBcIkBcIjogcmVzb2x2ZShfX2Rpcm5hbWUsIFwic3JjXCIpLFxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgcGx1Z2luczogW1xyXG4gICAgICAgIHN2ZWx0ZSgpLFxyXG5cclxuICAgICAgICB2aXRlU3RhdGljQ29weSh7XHJcbiAgICAgICAgICAgIHRhcmdldHM6IFtcclxuICAgICAgICAgICAgICAgIHsgc3JjOiBcIi4vUkVBRE1FKi5tZFwiLCBkZXN0OiBcIi4vXCIgfSxcclxuICAgICAgICAgICAgICAgIHsgc3JjOiBcIi4vQ0hBTkdFTE9HLm1kXCIsIGRlc3Q6IFwiLi9cIiB9LFxyXG4gICAgICAgICAgICAgICAgeyBzcmM6IFwiLi9wbHVnaW4uanNvblwiLCBkZXN0OiBcIi4vXCIgfSxcclxuICAgICAgICAgICAgICAgIHsgc3JjOiBcIi4vcHJldmlldy5wbmdcIiwgZGVzdDogXCIuL1wiIH0sXG4gICAgICAgICAgICAgICAgeyBzcmM6IFwiLi9pY29uLnBuZ1wiLCBkZXN0OiBcIi4vXCIgfSxcbiAgICAgICAgICAgICAgICB7IHNyYzogXCIuL2Fzc2V0cy8qXCIsIGRlc3Q6IFwiLi9hc3NldHMvXCIgfSxcbiAgICAgICAgICAgICAgICB7IHNyYzogXCIuL2kxOG4vKlwiLCBkZXN0OiBcIi4vaTE4bi9cIiB9LFxuICAgICAgICAgICAgICAgIHsgc3JjOiBcIi4vc3JjL3Rvb2xzL3NraWxscy8qLm1kXCIsIGRlc3Q6IFwiLi9za2lsbHMvXCIgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuXHJcbiAgICAgICAgLy8gQXV0byBjb3B5IHRvIFNpWXVhbiBwbHVnaW5zIGRpcmVjdG9yeSBpbiBkZXYgbW9kZVxyXG4gICAgICAgIC4uLihpc0RldiA/IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2F1dG8tY29weS10by1zaXl1YW4nLFxyXG4gICAgICAgICAgICAgICAgd3JpdGVCdW5kbGUoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSBjb3B5IHNjcmlwdCBhZnRlciBidWlsZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBleGVjU3luYygnbm9kZSAtLW5vLXdhcm5pbmdzIC4vc2NyaXB0cy9tYWtlX2Rldl9jb3B5LmpzJywge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RkaW86ICdpbmhlcml0JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN3ZDogcHJvY2Vzcy5jd2QoKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ0F1dG8gY29weSB0byBTaVl1YW4gZmFpbGVkOicsIGVycm9yLm1lc3NhZ2UpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1lvdSBjYW4gbWFudWFsbHkgcnVuOiBwbnBtIHJ1biBtYWtlLWxpbmstd2luJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXSA6IFtdKSxcclxuXHJcbiAgICBdLFxyXG5cclxuICAgIGRlZmluZToge1xyXG4gICAgICAgIFwicHJvY2Vzcy5lbnYuREVWX01PREVcIjogSlNPTi5zdHJpbmdpZnkoaXNEZXYpLFxyXG4gICAgICAgIFwicHJvY2Vzcy5lbnYuTk9ERV9FTlZcIjogSlNPTi5zdHJpbmdpZnkoZW52Lk5PREVfRU5WKVxyXG4gICAgfSxcclxuXHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIG91dERpcjogb3V0cHV0RGlyLFxyXG4gICAgICAgIC8vIEtlZXAgZXhpc3RpbmcgZmlsZXMgaW4gb3V0cHV0IGRpcmVjdG9yeSBmb3IgaW5jcmVtZW50YWwgYnVpbGRzXHJcbiAgICAgICAgZW1wdHlPdXREaXI6IGZhbHNlLFxyXG4gICAgICAgIG1pbmlmeTogdHJ1ZSxcclxuICAgICAgICBzb3VyY2VtYXA6IGlzU3JjbWFwID8gJ2lubGluZScgOiBmYWxzZSxcclxuXHJcbiAgICAgICAgbGliOiB7XHJcbiAgICAgICAgICAgIGVudHJ5OiByZXNvbHZlKF9fZGlybmFtZSwgXCJzcmMvaW5kZXgudHNcIiksXHJcbiAgICAgICAgICAgIGZpbGVOYW1lOiBcImluZGV4XCIsXHJcbiAgICAgICAgICAgIGZvcm1hdHM6IFtcImNqc1wiXSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgICAgICAgcGx1Z2luczogW1xyXG4gICAgICAgICAgICAgICAgLi4uKGlzRGV2ID8gW1xyXG4gICAgICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3dhdGNoLWV4dGVybmFsJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXN5bmMgYnVpbGRTdGFydCgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgZmcoW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICcuL2kxOG4vKionLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnLi9zcmMvdG9vbHMvc2tpbGxzLyoqJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJy4vUkVBRE1FKi5tZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICcuL0NIQU5HRUxPRy5tZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICcuL3BsdWdpbi5qc29uJ1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgZmlsZSBvZiBmaWxlcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYWRkV2F0Y2hGaWxlKGZpbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXSA6IFtcclxuICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB1bm5lY2Vzc2FyeSBmaWxlcyB1bmRlciBkaXN0IGRpclxyXG4gICAgICAgICAgICAgICAgICAgIGNsZWFudXBEaXN0RmlsZXMoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXR0ZXJuczogWydpMThuLyoueWFtbCcsICdpMThuLyoubWQnXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlzdERpcjogb3V0cHV0RGlyXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgemlwUGFjayh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGluRGlyOiAnLi9kaXN0JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3V0RGlyOiAnLi8nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvdXRGaWxlTmFtZTogJ3BhY2thZ2UuemlwJ1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICBdKVxyXG4gICAgICAgICAgICBdLFxyXG5cclxuICAgICAgICAgICAgZXh0ZXJuYWw6IFtcInNpeXVhblwiLCBcInByb2Nlc3NcIl0sXHJcblxyXG4gICAgICAgICAgICBvdXRwdXQ6IHtcclxuICAgICAgICAgICAgICAgIGVudHJ5RmlsZU5hbWVzOiBcIltuYW1lXS5qc1wiLFxyXG4gICAgICAgICAgICAgICAgYXNzZXRGaWxlTmFtZXM6IChhc3NldEluZm8pID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYXNzZXRJbmZvLm5hbWUgPT09IFwic3R5bGUuY3NzXCIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiaW5kZXguY3NzXCJcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFzc2V0SW5mby5uYW1lXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgLy8gXHU3OTgxXHU3NTI4XHU0RUUzXHU3ODAxXHU1MjA2XHU1MjcyXHVGRjBDXHU1QzA2XHU2MjQwXHU2NzA5XHU0RUUzXHU3ODAxXHU2MjUzXHU1MzA1XHU1MjMwXHU1MzU1XHU0RTJBXHU2NTg3XHU0RUY2XHU0RTJEXHJcbiAgICAgICAgICAgICAgICBtYW51YWxDaHVua3M6IHVuZGVmaW5lZCxcclxuICAgICAgICAgICAgICAgIGlubGluZUR5bmFtaWNJbXBvcnRzOiB0cnVlLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICB9XHJcbn0pO1xyXG5cclxuXHJcbi8qKlxyXG4gKiBDbGVhbiB1cCBzb21lIGRpc3QgZmlsZXMgYWZ0ZXIgY29tcGlsZWRcclxuICogQGF1dGhvciBmcm9zdGltZVxyXG4gKiBAcGFyYW0gb3B0aW9uczpcclxuICogQHJldHVybnMgXHJcbiAqL1xyXG5mdW5jdGlvbiBjbGVhbnVwRGlzdEZpbGVzKG9wdGlvbnM6IHsgcGF0dGVybnM6IHN0cmluZ1tdLCBkaXN0RGlyOiBzdHJpbmcgfSkge1xyXG4gICAgY29uc3Qge1xyXG4gICAgICAgIHBhdHRlcm5zLFxyXG4gICAgICAgIGRpc3REaXJcclxuICAgIH0gPSBvcHRpb25zO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgbmFtZTogJ3JvbGx1cC1wbHVnaW4tY2xlYW51cCcsXHJcbiAgICAgICAgZW5mb3JjZTogJ3Bvc3QnLFxyXG4gICAgICAgIHdyaXRlQnVuZGxlOiB7XHJcbiAgICAgICAgICAgIHNlcXVlbnRpYWw6IHRydWUsXHJcbiAgICAgICAgICAgIG9yZGVyOiAncG9zdCcgYXMgJ3Bvc3QnLFxyXG4gICAgICAgICAgICBhc3luYyBoYW5kbGVyKCkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZmcgPSBhd2FpdCBpbXBvcnQoJ2Zhc3QtZ2xvYicpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZnMgPSBhd2FpdCBpbXBvcnQoJ2ZzJyk7XHJcbiAgICAgICAgICAgICAgICAvLyBjb25zdCBwYXRoID0gYXdhaXQgaW1wb3J0KCdwYXRoJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gXHU0RjdGXHU3NTI4IGdsb2IgXHU4QkVEXHU2Q0Q1XHVGRjBDXHU3ODZFXHU0RkREXHU4MEZEXHU1MzM5XHU5MTREXHU1MjMwXHU2NTg3XHU0RUY2XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0UGF0dGVybnMgPSBwYXR0ZXJucy5tYXAocGF0ID0+IGAke2Rpc3REaXJ9LyR7cGF0fWApO1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5kZWJ1ZygnQ2xlYW51cCBzZWFyY2hpbmcgcGF0dGVybnM6JywgZGlzdFBhdHRlcm5zKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlcyA9IGF3YWl0IGZnLmRlZmF1bHQoZGlzdFBhdHRlcm5zLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgZG90OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIGFic29sdXRlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG9ubHlGaWxlczogZmFsc2VcclxuICAgICAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUuaW5mbygnRmlsZXMgdG8gYmUgY2xlYW5lZCB1cDonLCBmaWxlcyk7XHJcblxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZzLmRlZmF1bHQuZXhpc3RzU3luYyhmaWxlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhdCA9IGZzLmRlZmF1bHQuc3RhdFN5bmMoZmlsZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnMuZGVmYXVsdC5ybVN5bmMoZmlsZSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmRlZmF1bHQudW5saW5rU3luYyhmaWxlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBDbGVhbmVkIHVwOiAke2ZpbGV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gY2xlYW4gdXAgJHtmaWxlfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufVxyXG4i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QVE7QUFBQSxZQUNSLGFBQWE7QUFBQSxVQUNqQixDQUFDO0FBQUEsUUFDTDtBQUFBLE1BQ0o7QUFBQSxNQUVBLFVBQVUsQ0FBQyxVQUFVLFNBQVM7QUFBQSxNQUU5QixRQUFRO0FBQUEsUUFDSixnQkFBZ0I7QUFBQSxRQUNoQixnQkFBZ0IsQ0FBQyxjQUFjO0FBQzNCLGNBQUksVUFBVSxTQUFTLGFBQWE7QUFDaEMsbUJBQU87QUFBQSxVQUNYO0FBQ0EsaUJBQU8sVUFBVTtBQUFBLFFBQ3JCO0FBQUE7QUFBQSxRQUVBLGNBQWM7QUFBQSxRQUNkLHNCQUFzQjtBQUFBLE1BQzFCO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFDSixDQUFDO0FBU0QsU0FBUyxpQkFBaUIsU0FBa0Q7QUFDeEUsUUFBTTtBQUFBLElBQ0Y7QUFBQSxJQUNBO0FBQUEsRUFDSixJQUFJO0FBRUosU0FBTztBQUFBLElBQ0gsTUFBTTtBQUFBLElBQ04sU0FBUztBQUFBLElBQ1QsYUFBYTtBQUFBLE1BQ1QsWUFBWTtBQUFBLE1BQ1osT0FBTztBQUFBLE1BQ1AsTUFBTSxVQUFVO0FBQ1osY0FBTUEsTUFBSyxNQUFNLE9BQU8sOEdBQVc7QUFDbkMsY0FBTSxLQUFLLE1BQU0sT0FBTyxJQUFJO0FBSTVCLGNBQU0sZUFBZSxTQUFTLElBQUksU0FBTyxHQUFHLE9BQU8sSUFBSSxHQUFHLEVBQUU7QUFDNUQsZ0JBQVEsTUFBTSwrQkFBK0IsWUFBWTtBQUV6RCxjQUFNLFFBQVEsTUFBTUEsSUFBRyxRQUFRLGNBQWM7QUFBQSxVQUN6QyxLQUFLO0FBQUEsVUFDTCxVQUFVO0FBQUEsVUFDVixXQUFXO0FBQUEsUUFDZixDQUFDO0FBSUQsbUJBQVcsUUFBUSxPQUFPO0FBQ3RCLGNBQUk7QUFDQSxnQkFBSSxHQUFHLFFBQVEsV0FBVyxJQUFJLEdBQUc7QUFDN0Isb0JBQU0sT0FBTyxHQUFHLFFBQVEsU0FBUyxJQUFJO0FBQ3JDLGtCQUFJLEtBQUssWUFBWSxHQUFHO0FBQ3BCLG1CQUFHLFFBQVEsT0FBTyxNQUFNLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFBQSxjQUMvQyxPQUFPO0FBQ0gsbUJBQUcsUUFBUSxXQUFXLElBQUk7QUFBQSxjQUM5QjtBQUNBLHNCQUFRLElBQUksZUFBZSxJQUFJLEVBQUU7QUFBQSxZQUNyQztBQUFBLFVBQ0osU0FBUyxPQUFPO0FBQ1osb0JBQVEsTUFBTSxzQkFBc0IsSUFBSSxLQUFLLEtBQUs7QUFBQSxVQUN0RDtBQUFBLFFBQ0o7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFDSjsiLAogICJuYW1lcyI6IFsiZmciXQp9Cg==
