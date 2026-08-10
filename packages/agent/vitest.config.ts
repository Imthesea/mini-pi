import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^@mimi\/ai$/, replacement: aiSrcIndex },
    ],
  },
});
