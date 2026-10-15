import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordSchema } from '../server/password.js';
import { passwordPattern, validPassword } from '../src/password-policy.js';

test('aceita senhas de 8 caracteres com maiúscula, número e especial, sem exigir minúscula', () => {
  for (const password of ['Abcdef1!', 'ABCDEF1!', 'Ábcdef1!', 'Abcdef1@', 'Abcdef1-', 'Abcdef1_']) {
    assert.equal(passwordSchema.safeParse(password).success, true);
    assert.equal(new RegExp(`^(?:${passwordPattern})$`, 'v').test(password), true);
  }
});

test('rejeita senhas curtas, requisitos ausentes e espaços usados como especial', () => {
  for (const password of ['', 'Abcde1!', 'abcdef1!', 'Abcdefg!', 'Abcdef12', 'Abcdef1 ', 'Abcdef1á', 'A1!' + 'a'.repeat(126), null]) {
    assert.equal(passwordSchema.safeParse(password).success, false);
    assert.equal(validPassword(password), false);
  }
});
