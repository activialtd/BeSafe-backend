import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { AppEnv } from './config/env';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const config = app.get(ConfigService<AppEnv, true>);
  const port = config.get('PORT', { infer: true });
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  app.use(helmet({ contentSecurityPolicy: isProd }));
  app.set('trust proxy', 1);

  const originsRaw = config.get('CORS_ORIGINS', { infer: true });
  const origins = originsRaw === '*' ? true : originsRaw.split(',').map((s) => s.trim());
  app.enableCors({ origin: origins, credentials: true });

  // Only mount Swagger outside production
  if (!isProd) {
    const docConfig = new DocumentBuilder()
      .setTitle('BeSafe API')
      .setDescription('Lagos transport verification & safety platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, docConfig);
    SwaggerModule.setup('docs', app, doc);
  }

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  // Global uncaught safety-net: never crash the process
  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[uncaughtException]', err);
  });

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`BeSafe API listening on :${port}  (docs at /docs)`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap:', err);
  process.exit(1);
});
