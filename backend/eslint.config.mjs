// @ts-check
import eslint from '@eslint/js';
import eslintPluginImport from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Local rule: fails when a file uses an `@Api*` decorator (from
 * `@nestjs/swagger`) without importing it. This catches the regression
 * described in #1923, where controllers used `@ApiTags`, `@ApiOperation`,
 * etc. without importing them, breaking `tsc` and module loading.
 */
const noUndefinedApiDecoratorRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow using @Api* decorators without importing them from @nestjs/swagger',
    },
    schema: [],
    messages: {
      missingImport:
        "'{{name}}' is used but not imported from '@nestjs/swagger'.",
    },
  },
  create(context) {
    /** @type {Set<string>} */
    const importedApiNames = new Set();
    /** @type {Array<{ name: string, node: any }>} */
    const usedApiNames = [];

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@nestjs/swagger') {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            importedApiNames.add(specifier.local.name);
          }
        }
      },
      Decorator(node) {
        const expression = node.expression;
        if (
          expression.type === 'CallExpression' &&
          expression.callee.type === 'Identifier' &&
          /^Api[A-Z]/.test(expression.callee.name)
        ) {
          usedApiNames.push({ name: expression.callee.name, node });
        }
      },
      'Program:exit'() {
        for (const { name, node } of usedApiNames) {
          if (!importedApiNames.has(name)) {
            context.report({
              node,
              messageId: 'missingImport',
              data: { name },
            });
          }
        }
      },
    };
  },
};

const localPlugin = {
  rules: {
    'no-undefined-api-decorator': noUndefinedApiDecoratorRule,
  },
};

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginImport.flatConfigs.recommended,
  eslintPluginPrettierRecommended,
  {
    plugins: {
      local: localPlugin,
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      // Import ordering rules
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@nestjs/**',
              group: 'external',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      // Duplicate imports detection
      'import/no-duplicates': 'error',
      // Disable unresolved import warnings - TypeScript compiler will catch these
      'import/no-unresolved': 'off',
      // Catch @Api* decorators used without importing them from @nestjs/swagger (#1923)
      'local/no-undefined-api-decorator': 'error',
    },
  },
);
