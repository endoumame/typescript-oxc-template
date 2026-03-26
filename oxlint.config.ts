import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    nursery: "off",
    pedantic: "error",
    perf: "error",
    restriction: "error",
    style: "error",
    suspicious: "error",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
      plugins: ["vitest"],
      rules: {
        "typescript/no-explicit-any": "off",
      },
    },
    {
      files: ["**/*.vue"],
      plugins: ["vue"],
      rules: {
        "unicorn/filename-case": "off",
      },
    },
    {
      files: ["**/*.config.ts", "**/*.config.js", "**/worker.ts", "**/src/index.ts"],
      rules: {
        "import/no-default-export": "off",
      },
    },
    {
      files: ["**/sw.js"],
      rules: {
        "import/unambiguous": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-type-assertion": "off",
      },
    },
    {
      files: ["**/env.d.ts", "**/*.d.ts"],
      rules: {
        "import/unambiguous": "off",
      },
    },
  ],
  plugins: ["typescript", "import", "unicorn"],
  rules: {
    "import/no-cycle": "error",
    "import/no-duplicates": "error",
    "import/no-named-export": "off",
    "import/no-relative-parent-imports": "off",
    "import/no-self-import": "error",
    "import/no-unassigned-import": "off",
    "import/prefer-default-export": "off",
    "no-duplicate-imports": "off",
    "no-extra-semi": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-ternary": "off",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "unicorn/no-null": "off",
  },
});
