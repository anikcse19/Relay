import { createDb } from '@relay/db';
import { defaultUrlPolicy } from '@relay/shared';
import { pino } from 'pino';
import { ConfigError, loadDotEnv, parseEnv } from './env.js';
import { DEFAULT_HEALTH } from './health.js';
import { startWorker } from './worker.js';

function bootstrap() {
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

  const logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'worker' },
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname', singleLine: true },
      },
    }),
  });

  const database = createDb({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const worker = startWorker({
    database,
    logger,
    concurrency: env.WORKER_CONCURRENCY,
    timeoutMs: env.DELIVERY_TIMEOUT_MS,
    urlPolicy: defaultUrlPolicy(env.NODE_ENV, env.ENDPOINT_URL_POLICY),
    health: {
      ...DEFAULT_HEALTH,
      circuitThreshold: env.CIRCUIT_FAILURE_THRESHOLD,
      autoDisableAfterMs: env.AUTO_DISABLE_AFTER_HOURS * 3_600_000,
    },
    retentionDays: env.RETENTION_DAYS,
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down: finishing in-flight deliveries');
    // Anything still in flight when the platform kills us is safe: its lease
    // expires and another worker retries it (at-least-once, ADR-0003).
    await worker.stop();
    await database.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap();
