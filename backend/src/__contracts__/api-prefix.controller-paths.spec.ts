import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';

const controllerFiles = [
  '../blood-requests/controllers/order-splitting.controller.ts',
  '../blood-units/controllers/disposition.controller.ts',
  '../common/errors/error-documentation.controller.ts',
  '../contract-event-indexer/contract-event-indexer.controller.ts',
  '../escalation/escalation.controller.ts',
  '../events/dead-letter.controller.ts',
  '../events/outbox.controller.ts',
  '../notifications/controllers/notification-preference.controller.ts',
  '../organizations/stats/org-stats.controller.ts',
  '../readiness/readiness.controller.ts',
  '../route-deviation/route-deviation.controller.ts',
];

function getControllerPath(filePath: string): string {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(resolve(__dirname, filePath), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;

    const decorators = ts.canHaveDecorators(statement)
      ? ts.getDecorators(statement)
      : undefined;

    for (const decorator of decorators ?? []) {
      const expression = decorator.expression;
      if (
        ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'Controller' &&
        expression.arguments[0] &&
        ts.isStringLiteral(expression.arguments[0])
      ) {
        return expression.arguments[0].text;
      }
    }
  }

  throw new Error(`No @Controller path found in ${filePath}`);
}

describe('API controller paths', () => {
  it('does not map controllers under a duplicated global API prefix', () => {
    const globalPrefix = 'api/v1';
    const mappedPaths = controllerFiles.map(
      (filePath) => `/${globalPrefix}/${getControllerPath(filePath)}`,
    );

    expect(mappedPaths).toHaveLength(controllerFiles.length);
    expect(
      mappedPaths.some((path) => path.includes('/api/v1/api/v1/')),
    ).toBe(false);
  });
});