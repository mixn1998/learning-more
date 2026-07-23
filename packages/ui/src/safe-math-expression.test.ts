import { describe, expect, it } from 'vitest';

import { compileSafeMathExpression, SafeMathExpressionError } from './safe-math-expression.js';

describe('compileSafeMathExpression', () => {
  it('evaluates approved elementary functions, constants, and variables', () => {
    const expression = compileSafeMathExpression('sin(x)^2 + cos(x)^2 + ln(e)', ['x']);
    expect(expression({ x: 0.37 })).toBeCloseTo(2, 10);
  });

  it('returns undefined for non-real or non-finite sample values', () => {
    const root = compileSafeMathExpression('sqrt(x)', ['x']);
    const pole = compileSafeMathExpression('1/x', ['x']);
    expect(root({ x: -1 })).toBeUndefined();
    expect(pole({ x: 0 })).toBeUndefined();
  });

  it.each([
    'x = 2',
    'f(x) = x^2',
    '[x, 2]',
    'import({evil: 1})',
    'evaluate("2+2")',
    'x.foo',
    'random()',
  ])('rejects unsafe or non-deterministic expression %s', (source) => {
    expect(() => compileSafeMathExpression(source, ['x'])).toThrow(SafeMathExpressionError);
  });

  it('rejects symbols outside the declared variable set', () => {
    try {
      compileSafeMathExpression('x+y', ['x']);
      throw new Error('expected expression rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(SafeMathExpressionError);
      expect((error as SafeMathExpressionError).code).toBe('symbol_not_allowed');
    }
  });
});
