/**
 * 支持 AbortSignal 取消的 sleep 辅助函数。
 *
 * 从 pi 项目 utils/sleep.ts 照抄（V1 最小化）。
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Aborted"));
    });
  });
}
