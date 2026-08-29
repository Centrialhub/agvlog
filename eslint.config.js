import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // These are stable, intentional co-exports from UI primitives/providers.
      // Domain utilities live in dedicated lib modules instead of this allowlist.
      "react-refresh/only-export-components": ["warn", {
        allowConstantExport: true,
        allowExportNames: [
          "badgeVariants",
          "buttonVariants",
          "navigationMenuTriggerStyle",
          "toast",
          "toggleVariants",
          "useAuth",
          "useFormField",
          "useIsAdmin",
          "usePortalClientScope",
          "useSidebar",
          "useTenant",
        ],
      }],
      // Existing occurrences are visible as warnings and governed by the
      // decreasing baseline. `lint:critical-types --max-warnings 0` turns the
      // same rule into a hard gate for release-critical files.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      // Legacy debt across Supabase hooks and edge functions — kept as warn to
      // avoid a risky mass refactor while still surfacing new occurrences.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-useless-escape": "warn",
      "no-empty": "warn",
      "no-constant-binary-expression": "warn",
      "no-prototype-builtins": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["src/hooks/**/*.{ts,tsx}"],
    rules: {
      // Hook-only modules are not React component refresh boundaries.
      "react-refresh/only-export-components": "off",
    },
  },
);
