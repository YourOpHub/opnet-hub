import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // ── Global ignores ──
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'deploy/**',
      'server/**',
      'faucet/**',
      'scripts/**',
      '*.config.js',
      '*.config.ts',
      'vite.config.ts',
    ],
  },

  // ── Base JS recommended rules ──
  js.configs.recommended,

  // ── TypeScript-aware config for src/ ──
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // ── TypeScript strict rules ──
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowConciseArrowFunctionExpressionsStartingWithVoid: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false },
      ],
      '@typescript-eslint/strict-boolean-expressions': [
        'warn',
        {
          allowString: true,
          allowNumber: true,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: true,
          allowAny: false,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // ── Console usage — use logger instead ──
      'no-console': 'error',

      // ── Disable base rules that conflict with TS versions ──
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',

      // ── React hooks rules ──
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── General quality rules ──
      'no-debugger': 'error',
      'no-duplicate-imports': 'off', // handled by TS
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },

  // ── Relaxed rules for test files ──
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'no-console': 'off',
      'no-constant-binary-expression': 'off',
    },
  },

  // ── Logger is the one file that legitimately wraps console ──
  {
    files: ['src/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
