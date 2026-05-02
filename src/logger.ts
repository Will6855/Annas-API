import winston from 'winston';
import { config } from './config';

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  let output = `${timestamp} [${level}] ${message}`;
  if (Object.keys(meta).length > 0) {
    output += ` ${JSON.stringify(meta)}`;
  }
  return output;
});

const isDev = config.server.env !== 'production';

export const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  format: combine(
    timestamp({ format: 'HH:mm:ss' }),
    isDev ? colorize() : winston.format.uncolorize(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
