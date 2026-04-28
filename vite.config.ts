import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri 需要一个固定端口
  server: {
    port: 1420,
    strictPort: true,
  },
  // Tauri 使用相对路径
  base: './',
  // 环境变量前缀
  envPrefix: ['VITE_', 'TAURI_'],
})
