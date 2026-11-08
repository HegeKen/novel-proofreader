/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string

/** 是否为 Web 版构建（由 Vite define 注入） */
declare const __PROOFREADER_WEB__: boolean