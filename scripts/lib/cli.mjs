/**
 * CLI 入口包装。
 *
 * 取消信号（CancelledError，定义于 prompt.mjs）按名字鸭子识别，避免 CLI 层依赖交互层。
 */

import { log } from "./log.mjs";

/**
 * CLI 入口包装：把异常收敛成「一行错误 + 退出码 1」，而不是甩一坨调用栈。
 * 需要完整堆栈时设 DSH_DEBUG=1。
 */
export function runCli(main) {
	Promise.resolve()
		.then(() => main())
		.catch((error) => {
			if (error?.name === "CancelledError") {
				log.warn("已取消");
				process.exitCode = 130;
				return;
			}
			log.fail(error?.message ?? String(error));
			if (process.env.DSH_DEBUG) console.error(error);
			process.exitCode = 1;
		});
}
