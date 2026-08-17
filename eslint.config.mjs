import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // The alternative build output (NEXT_DIST_DIR in next.config.ts). Same
      // reason `.next` is ignored: it is generated bundles, and linting them
      // produces hundreds of errors about code nobody wrote.
      ".next-build/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },
  {
    rules: {
      // Server actions are called by `useActionState` with a fixed
      // (previousState, formData) signature, so an action that ignores one of
      // them still has to declare it. The `_` prefix is how the codebase marks
      // that as deliberate.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default eslintConfig;
