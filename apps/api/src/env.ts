import { config } from 'dotenv';
import { resolve } from 'node:path';

// Environment variables injected by a container or CI take precedence. The root
// .env is only a local-development convenience for workspace scripts.
config({ path: resolve(__dirname, '../.env'), override: false });
config({ path: resolve(__dirname, '../../../.env'), override: false });
