// A bounded expression grammar, never JavaScript evaluation. Angles are radians.
export function compileExpression(source) {
  const input = String(source).trim().toLowerCase().replaceAll('π', 'pi').replaceAll('×', '*').replaceAll('÷', '/').replaceAll('²', '^2').replaceAll('√', 'sqrt');
  if (!input || input.length > 240) throw Error('Enter an expression up to 240 characters.');
  const tokens = input.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+|[()+\-*/^]/gi) || [];
  if (tokens.join('') !== input.replace(/\s/g, '') || tokens.length > 160) throw Error('Use numbers, x, π, + − * / ^, parentheses, sqrt, sin, cos, tan, abs or log.');
  let at = 0;
  const functions = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, log: Math.log10 };
  function atom() {
    const token = tokens[at++];
    if (token === '(') { const value = sum(); if (tokens[at++] !== ')') throw Error('Close the parentheses.'); return value; }
    if (token === 'x') return x => x;
    if (token === 'pi') return () => Math.PI;
    if (token === 'e') return () => Math.E;
    if (Object.hasOwn(functions, token)) {
      if (tokens[at++] !== '(') throw Error('Put the function input in parentheses.');
      const arg = sum(); if (tokens[at++] !== ')') throw Error('Close the parentheses.');
      return x => functions[token](arg(x));
    }
    if (token && /^(?:\d|\.)/.test(token)) return () => Number(token);
    throw Error('The expression is incomplete.');
  }
  function power() { const a = atom(); if (tokens[at] !== '^') return a; at++; const b = unary(); return x => a(x) ** b(x); }
  function unary() { if (tokens[at] === '-' || tokens[at] === '+') { const sign = tokens[at++] === '-' ? -1 : 1, value = unary(); return x => sign * value(x); } return power(); }
  function product() { let a = unary(); while (['*', '/'].includes(tokens[at])) { const op = tokens[at++], left = a, right = unary(); a = x => op === '*' ? left(x) * right(x) : left(x) / right(x); } return a; }
  function sum() { let a = product(); while (['+', '-'].includes(tokens[at])) { const op = tokens[at++], left = a, right = product(); a = x => op === '+' ? left(x) + right(x) : left(x) - right(x); } return a; }
  const evaluate = sum();
  if (at !== tokens.length) throw Error('Use an operator between values, such as 2*x.');
  return { evaluate, hasX: tokens.includes('x') };
}
export function calculate(source) {
  const { evaluate, hasX } = compileExpression(source);
  if (hasX) {
    const segments = []; let line = [], previous;
    for (let i = 0; i <= 400; i++) {
      const x = -10 + i / 20, y = evaluate(x);
      if (!Number.isFinite(y) || Math.abs(y) > 10 || (previous !== undefined && Math.abs(y - previous) > 4)) {
        if (line.length > 1) segments.push(line); line = [];
      }
      if (Number.isFinite(y) && Math.abs(y) <= 10) line.push([x, y]);
      previous = y;
    }
    if (line.length > 1) segments.push(line);
    return { text: segments.length ? `y = ${source} · x and y: −10 to 10` : 'No curve is visible in the −10 to 10 window.', segments };
  }
  const value = evaluate(0);
  if (!Number.isFinite(value)) throw Error('No finite real result. Check the domain or division by zero.');
  return { text: String(Number(value.toPrecision(12))), value };
}

/** Only clearly mathematical speech is offered to the local calculator. */
export function expressionFromSpeech(text) {
  const match = String(text).trim().match(/^(calculate|evaluate|graph|plot|what is|what's)\s+(.+?)[?.!]?$/i);
  if (!match) return null;
  const expression = match[2].toLowerCase().replace(/^y\s*=\s*/, '')
    .replace(/\bmultiplied by\b|\btimes\b/g, '*').replace(/\bdivided by\b/g, '/')
    .replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\bsquared\b/g, '^2')
    .replace(/\bpi\b/g, 'π').replace(/^square root of\s+(.+)$/, 'sqrt($1)');
  if (/^what/i.test(match[1])) {
    try { compileExpression(expression); } catch { return null; }
  }
  return expression;
}
