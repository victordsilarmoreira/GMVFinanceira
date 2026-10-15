import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, originGuard } from '../server/origin.js';

const local = { APP_URL: 'http://localhost:5173', PORT: '3100', NODE_ENV: 'development' };
function check(origin, env = local, header = '1') {
  let status = 200;
  const req = { method: 'POST', get: name => name === 'origin' ? origin : header };
  const res = { set() {}, status(code) { status = code; return this; }, json() {} };
  originGuard(allowedOrigins(env))(req, res, () => {});
  return status;
}
test('permite os nomes locais nas portas configuradas em desenvolvimento', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const port of [5173, 3100]) assert.equal(check(`http://${host}:${port}`), 200);
  }
});
test('rejeita domínios externos, origens opacas, portas e protocolos não configurados', () => {
  for (const origin of ['https://example.com', 'http://localhost.evil.test:5173', 'http://localhost:5174', 'https://localhost:5173', 'null', '']) {
    assert.equal(check(origin), 403, origin);
  }
});
test('produção aceita apenas a origem exata de APP_URL', () => {
  const env = { ...local, NODE_ENV: 'production', APP_URL: 'https://financeira.example.com' };
  assert.equal(check(env.APP_URL, env), 200);
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:3100', 'http://financeira.example.com']) assert.equal(check(origin, env), 403);
  assert.equal(check('http://127.0.0.1:5173', { ...local, NODE_ENV: 'production' }), 403);
});
test('não deriva origens locais de configuração remota ou ambiente indefinido', () => {
  assert.equal(check('http://localhost:5173', { ...local, APP_URL: 'https://financeira.example.com' }), 403);
  assert.equal(check('http://127.0.0.1:5173', { ...local, NODE_ENV: undefined }), 403);
});
test('preserva cabeçalho anti-CSRF mesmo em origem autorizada ou cliente sem Origin', () => {
  assert.equal(check('http://localhost:5173', local, ''), 403);
  assert.equal(check(undefined, local, ''), 403);
  assert.equal(check(undefined), 200);
});
