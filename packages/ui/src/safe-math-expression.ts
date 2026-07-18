import { parse, type MathNode } from 'mathjs';

const MAX_EXPRESSION_LENGTH = 500;
const MAX_AST_NODES = 120;
const MAX_AST_DEPTH = 18;

const allowedConstants = new Set(['e', 'pi', 'PI']);
const allowedFunctions = new Set([
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'ceil',
  'cos',
  'cosh',
  'exp',
  'floor',
  'ln',
  'log',
  'log10',
  'max',
  'min',
  'round',
  'sign',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
]);
const allowedOperators = new Set([
  'add',
  'subtract',
  'multiply',
  'divide',
  'pow',
  'mod',
  'unaryMinus',
  'unaryPlus',
]);

export type MathScope = Readonly<Record<string, number>>;
export type SafeMathEvaluator = (scope: MathScope) => number | undefined;
export type SafeMathExpressionErrorCode =
  | 'expression_too_long'
  | 'expression_invalid'
  | 'node_not_allowed'
  | 'symbol_not_allowed'
  | 'function_not_allowed'
  | 'operator_not_allowed'
  | 'expression_too_complex';

export class SafeMathExpressionError extends Error {
  constructor(readonly code: SafeMathExpressionErrorCode) {
    super(code);
    this.name = 'SafeMathExpressionError';
  }
}

type NamedNode = MathNode & { readonly name: string };
type ConstantNode = MathNode & { readonly value: unknown };
type OperatorNode = MathNode & { readonly fn: string };
type FunctionNode = MathNode & { readonly fn: NamedNode };

function validateNode(
  node: MathNode,
  variables: ReadonlySet<string>,
  state: { count: number },
  depth: number,
): void {
  state.count += 1;
  if (state.count > MAX_AST_NODES || depth > MAX_AST_DEPTH) {
    throw new SafeMathExpressionError('expression_too_complex');
  }

  switch (node.type) {
    case 'ConstantNode':
      if (typeof (node as ConstantNode).value !== 'number') {
        throw new SafeMathExpressionError('node_not_allowed');
      }
      break;
    case 'SymbolNode': {
      const name = (node as NamedNode).name;
      if (!variables.has(name) && !allowedConstants.has(name) && !allowedFunctions.has(name)) {
        throw new SafeMathExpressionError('symbol_not_allowed');
      }
      break;
    }
    case 'OperatorNode':
      if (!allowedOperators.has((node as OperatorNode).fn)) {
        throw new SafeMathExpressionError('operator_not_allowed');
      }
      break;
    case 'FunctionNode': {
      const name = (node as FunctionNode).fn.name;
      if (!allowedFunctions.has(name)) {
        throw new SafeMathExpressionError('function_not_allowed');
      }
      break;
    }
    case 'ParenthesisNode':
      break;
    default:
      throw new SafeMathExpressionError('node_not_allowed');
  }

  node.forEach((child) => validateNode(child, variables, state, depth + 1));
}

export function compileSafeMathExpression(
  source: string,
  variables: readonly string[],
): SafeMathEvaluator {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new SafeMathExpressionError('expression_too_long');
  }

  let node: MathNode;
  try {
    node = parse(source);
  } catch {
    throw new SafeMathExpressionError('expression_invalid');
  }

  validateNode(node, new Set(variables), { count: 0 }, 0);
  const compiled = node.compile();

  return (scope) => {
    try {
      const evaluationScope = new Map<string, unknown>(Object.entries(scope));
      evaluationScope.set('ln', Math.log);
      const value: unknown = compiled.evaluate(evaluationScope);
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
}
