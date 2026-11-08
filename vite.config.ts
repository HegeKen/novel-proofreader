import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const packageJson = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'))

// Web 版构建：把 Tauri API 替换为 HTTP/浏览器适配层（桌面构建保持原样）
const webBuild = process.env.PROOFREADER_WEB === '1'
const backendDir = path.resolve(import.meta.dirname, 'src/lib/backend')
const webAliases: Record<string, string> = webBuild
  ? {
      '@tauri-apps/api/core': path.join(backendDir, 'tauri-core-shim.ts'),
      '@tauri-apps/api/event': path.join(backendDir, 'tauri-event-shim.ts'),
      '@tauri-apps/api/app': path.join(backendDir, 'tauri-app-shim.ts'),
      '@tauri-apps/api/window': path.join(backendDir, 'tauri-window-shim.ts'),
      '@tauri-apps/plugin-dialog': path.join(backendDir, 'tauri-dialog-shim.ts'),
      '@tauri-apps/plugin-fs': path.join(backendDir, 'tauri-fs-shim.ts'),
      '@tauri-apps/plugin-notification': path.join(backendDir, 'tauri-notification-shim.ts'),
    }
  : {}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      // 开发时把接口转发到本地 Web 服务
      '/api': {
        target: process.env.PROOFREADER_API_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: webAliases,
  },
  base: webBuild ? '/' : './',
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __PROOFREADER_WEB__: JSON.stringify(webBuild),
  },
})
