import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNumericExpression, isNumericLiteral } from "../../src/web/shared/numeric-expression.js";

test("numeric expressions apply arithmetic precedence, grouping, and unary signs", () => {
  assert.equal(evaluateNumericExpression("188 - 4"), 184);
  assert.equal(evaluateNumericExpression("2 + 3 * 4"), 14);
  assert.equal(evaluateNumericExpression("(2 + 3) * 4"), 20);
  assert.equal(evaluateNumericExpression("-2 * -(3 + 1)"), 8);
  assert.equal(evaluateNumericExpression(".5 + 1e1"), 10.5);
});

test("numeric expressions reject incomplete, unknown, implicit, and non-finite results", () => {
  assert.equal(evaluateNumericExpression(""), undefined);
  assert.equal(evaluateNumericExpression("1 +"), undefined);
  assert.equal(evaluateNumericExpression("2(3)"), undefined);
  assert.equal(evaluateNumericExpression("1 / 0"), undefined);
  assert.equal(evaluateNumericExpression("1e999"), undefined);
  assert.equal(evaluateNumericExpression("Math.max(1, 2)"), undefined);
});

test("plain numeric literals stay distinguishable from deferred expressions", () => {
  assert.equal(isNumericLiteral(" -19.5e-2 "), true);
  assert.equal(isNumericLiteral("188 - 4"), false);
  assert.equal(isNumericLiteral("1e999"), false);
});
