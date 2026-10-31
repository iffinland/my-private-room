import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler-style rules that flag legitimate external bridge and
      // async-loading effects in this app. The classic hooks rules stay on.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: ['useTheme'] }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);
