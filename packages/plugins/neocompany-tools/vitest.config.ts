//// Neocompany Modification — vitest config for neocompany-tools tests
//// Lives under packages/plugins/neocompany-tools/vitest.config.ts so the
//// root vitest.config.ts can pick it up as a project.
//// End Neocompany Modification

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: [],
  },
});
