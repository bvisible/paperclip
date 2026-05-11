//// Neocompany Modification — vitest config for paperclip-chat tests
//// End Neocompany Modification

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
