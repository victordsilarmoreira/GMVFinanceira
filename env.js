import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve the project configuration independently of the terminal's directory.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
