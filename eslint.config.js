import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'artifacts/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@hebcal/core',
              message: 'Les bibliothèques de référence sont réservées aux scripts et tests.',
            },
            {
              name: 'kosher-zmanim',
              message: 'Les bibliothèques de référence sont réservées aux scripts et tests.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'fs/**', 'path', 'path/**'],
              message: 'Le domaine doit rester indépendant de Node.js.',
            },
            {
              group: ['@hebcal/core', 'kosher-zmanim'],
              message: 'Les bibliothèques de référence sont réservées aux scripts et tests.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Le domaine ne dépend pas du navigateur.' },
        { name: 'document', message: 'Le domaine ne dépend pas du navigateur.' },
        { name: 'navigator', message: 'Le domaine ne dépend pas du navigateur.' },
        { name: 'localStorage', message: 'Le domaine ne dépend pas du navigateur.' },
        { name: 'sessionStorage', message: 'Le domaine ne dépend pas du navigateur.' },
        { name: 'process', message: 'Le domaine ne dépend pas de Node.js.' },
        { name: 'Buffer', message: 'Le domaine ne dépend pas de Node.js.' },
      ],
    },
  },
  prettier,
);
