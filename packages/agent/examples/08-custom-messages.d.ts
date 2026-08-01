/**
 * Example 08 自定义类型声明。
 *
 * 通过 `declare module` 把 `notification` 消息类型合并到 `@mimi/agent`
 * 的 `CustomAgentMessages` 接口中。这是 TS 声明合并(declaration merging)
 * 的标准用法 —— 用户在自己项目里加这一段,就能让 AgentMessage 联合类型
 * 多出一个 `notification` 变体。
 *
 * 为什么放在独立的 .d.ts 文件:
 * - 声明合并的 scope 是文件级,放在主 .ts 文件会影响整个 tsconfig 的类型
 * - 独立 .d.ts 文件 + 明确的 module 路径,避免污染测试编译
 * - 演示"用户怎么在自己的项目里扩展"的标准做法
 */

declare module "@mimi/agent" {
  interface CustomAgentMessages {
    /** UI 推过来的系统通知,需要 LLM 看到后给出回应 */
    notification: {
      role: "custom";
      customType: "notification";
      title: string;
      body: string;
      level: "info" | "warn" | "error";
      timestamp: number;
    };
  }
}

export {};
