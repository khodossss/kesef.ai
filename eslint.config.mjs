import js from '@eslint/js';
import globals from 'globals';

// Flat ESLint config for the plain-.mjs connector. The code straddles two runtimes:
// Node (the MCP server, store, refresh) and the browser (page.evaluate callbacks in
// the extractors), so both global sets are declared to avoid false no-undef errors.
export default [
  { ignores: ['node_modules/**', 'data/**', 'profiles/**'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Empty catch blocks are intentional here — several swallow transient
      // page/navigation errors on purpose (each is commented at the call site).
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
