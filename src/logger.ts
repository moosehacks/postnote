import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

export const log = pino(
  isDev
    ? {
        level: 'debug',
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }
    : { level: 'info' },
);
