// ============================================================
// 校对前台服务插件：桥接 Rust 侧的 start/stop 调用
// 用于熄屏模式下保持后台持续检测
// ============================================================

package cn.helilab.proofreader

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class ProofreadPlugin(private val ctx: Activity) : Plugin(ctx) {

    @Command
    fun start(invoke: Invoke) {
        try {
            ProofreadSyncService.start(ctx)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "启动熄屏保活服务失败")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        try {
            ProofreadSyncService.stop(ctx)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "停止熄屏保活服务失败")
        }
    }
}
