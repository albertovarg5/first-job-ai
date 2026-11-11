import js from '@eslint/js';
import globals from 'globals';

// Simple config: ESLint's recommended rules only. Server and scripts run in
// Node, src/ runs in the browser, tests run in Node.
export default [
  { ignores: ['dist/', 'node_modules/', 'data/', 'public/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser },
    },
    // Capitalized names are React components used in JSX, which core ESLint can't see.
    rules: {
      // Rules added in ESLint 10 that flag working server code; not worth refactoring for Sprint 1.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
