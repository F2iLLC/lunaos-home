import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, compileExpression } from '../src/calculator.js';

test('calculator respects precedence, unary signs, powers, constants and scientific functions', () => {
  for (const [expression, expected] of [['2+3*4',14],['(2+3)*4',20],['-2^2',-4],['2^-2',.25],['2^3^2',512],['sqrt(9)+abs(-2)',5],['sin(π/2)',1],['log(100)',2],['3²',9],['1e3/4',250]]) assert.equal(calculate(expression).value, expected, expression);
});
test('calculator rejects code, malformed input and non-finite real outputs', () => {
  for (const input of ['globalThis.alert(1)', 'constructor(1)', '1;2', 'Math.PI', '2x', '(2+3', '2+', '1/0', 'sqrt(-1)', '9^999', '('.repeat(241)]) assert.throws(() => calculate(input), undefined, input);
});
test('graphs evaluate the expression, bound samples and split poles', () => {
  const {segments} = calculate('x^2');
  assert.ok(segments.flat().some(([x,y]) => x === 2 && y === 4));
  assert.ok(segments.flat().every(([x,y]) => Number.isFinite(y) && Math.abs(y) <= 10 && Math.abs(x) <= 10));
  assert.equal(calculate('1/x').segments.length, 2);
  assert.equal(compileExpression('cos(x)').evaluate(0), 1);
  assert.equal(calculate('sqrt(-1)+x').segments.length, 0);
});

test('spoken math is scoped and unrelated questions keep normal responses',async()=>{
  const {expressionFromSpeech}=await import('../src/calculator.js');
  assert.equal(calculate(expressionFromSpeech('What is 2 plus 3?')).value,5);
  assert.equal(calculate(expressionFromSpeech('Calculate square root of 9')).value,3);
  assert.equal(expressionFromSpeech('Graph y = sin(x)'), 'sin(x)');
  assert.equal(expressionFromSpeech('What is the weather?'),null);
  assert.equal(expressionFromSpeech('Add milk to groceries'),null);
});
