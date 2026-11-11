import { fileURLToPath } from 'node:url';

/** Absolute path to generated SQL migrations (works from both src/ and dist/). */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
