import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^@mimi\/ai$/, replacement: aiSrcIndex },
      { find: /^@mimi\/agent$/, replacement: agentSrcIndex },
    ],
  },
});
