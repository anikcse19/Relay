import { createDb } from '@relay/db';
import { createApp } from './app.js';
import { ConfigError, loadDotEnv, parseEnv } from './config/env.js';

async function bootstrap() {
  loadDotEnv();

  let env;
  try {
    env = parseEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n✖ ${error.message}\n\nCheck your .env file (see .env.example).\n`);
      process.exit(1);
    }
    throw error;
  }

  const database = createDb({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const app = await createApp({ env, database });

  await app.listen(env.PORT, env.HOST);

  const url = `http://localhost:${env.PORT}`;
  app.getHttpAdapter().getInstance().log.info(`Relay API ready → ${url}  ·  docs → ${url}/docs`);
}

void bootstrap();
