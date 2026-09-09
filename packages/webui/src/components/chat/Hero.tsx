import { Composer } from "./Composer";

interface HeroProps {
  currentModel: string;
  accessMode: string;
  onSend: (content: string) => void;
}

/**
 * 空态 hero：居中标题 + 副标题 + 输入区。
 * 复用 Composer（只读模型/访问模式行 + 发送），发送逻辑与对话态一致。
 */
export function Hero({ currentModel, accessMode, onSend }: HeroProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-semibold">mimi</h1>
      <p className="mt-2 text-sm text-muted-foreground">描述你想构建的东西</p>
      <div className="mt-6 w-full max-w-3xl">
        <Composer
          isRunning={false}
          currentModel={currentModel}
          accessMode={accessMode}
          onSend={onSend}
          onStop={() => {}}
        />
      </div>
    </div>
  );
}
