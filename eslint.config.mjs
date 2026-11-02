import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/**",
    // Superpowers 플러그인의 로컬 작업 폴더 (.gitignore에 있음). 안의 .venv 등을 검사하지 않게 한다
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
