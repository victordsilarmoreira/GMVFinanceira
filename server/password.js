import { z } from 'zod';
import { passwordMessage, validPassword } from '../src/password-policy.js';

export const passwordSchema = z.string().max(128).refine(validPassword, passwordMessage);
