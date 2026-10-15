export const passwordMessage = 'A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.';
export const passwordPattern = String.raw`(?=.*\p{Lu})(?=.*[0-9])(?=.*[^\p{L}\p{N}\s])[\s\S]{8,128}`;
export const validPassword = value => typeof value === 'string' && new RegExp(`^(?:${passwordPattern})$`, 'u').test(value);
