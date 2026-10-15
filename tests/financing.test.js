import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financingFromAmount, financingLimits } from '../src/financing.js';
const p = { percentual_min: 10, percentual_max: 80 };
test('valor digitado define percentual e parcela, preservando os centavos', () => {
  const result = financingFromAmount(50000, 12345.67, 48, 2, p);
  assert.equal(result.valor_financiado, 12345.67);
  assert.equal(result.percentual, 24.69134);
  assert.equal(result.valor_parcela, 402.49);
  assert.equal(financingFromAmount(50000, 40000, 48, 2, p).valor_parcela, 1304.07);
});
test('mínimo e máximo são inclusivos, mas um centavo fora é rejeitado', () => {
  assert.deepEqual(financingLimits(50000, p), { min: 5000, max: 40000 });
  for (const value of [5000, 40000]) assert.doesNotThrow(() => financingFromAmount(50000, value, 48, 2, p));
  for (const value of [4999.99, 40000.01]) assert.throws(() => financingFromAmount(50000, value, 48, 2, p), /entre/);
});
test('limites fracionários arredondam para dentro da faixa permitida', () => {
  assert.deepEqual(financingLimits(33333.33, p), { min: 3333.34, max: 26666.66 });
  for (const value of [3333.33, 26666.67]) assert.throws(() => financingFromAmount(33333.33, value, 48, 2, p));
  for (const value of [3333.34, 26666.66]) assert.doesNotThrow(() => financingFromAmount(33333.33, value, 48, 2, p));
});
test('exige FIPE e valor positivo com precisão de centavos', () => {
  for (const fipe of [null, 0, NaN]) assert.throws(() => financingFromAmount(fipe, 5000, 48, 2, p), /FIPE/);
  for (const value of [0, -1, null, NaN, Infinity, 5000.001]) assert.throws(() => financingFromAmount(50000, value, 48, 2, p));
});
test('juros zero dividem o valor informado pelo prazo', () => {
  assert.equal(financingFromAmount(50000, 15000, 12, 0, p).valor_parcela, 1250);
});
