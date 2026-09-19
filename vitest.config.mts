import { defineConfig } from "vitest/config";
import path from "node:path";

// `@/lib/...` is how the app imports itself (tsconfig paths). vitest does not
// read tsconfig paths, so without this the route handlers cannot be imported
// by a test and the access rules in them go untested.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
