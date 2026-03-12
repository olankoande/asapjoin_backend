import dotenv from 'dotenv';

dotenv.config();

export const env = {
  // App
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  APP_URL: process.env.APP_URL || 'http://localhost:5173',
  API_URL: process.env.API_URL || 'http://localhost:3000',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  // DB
  DATABASE_URL: process.env.DATABASE_URL || '',

  // Auth
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'change-me',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'change-me',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_CURRENCY: process.env.STRIPE_CURRENCY || 'CAD',

  // Email
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'console',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RENDER_EMAIL_API_KEY: process.env.RENDER_EMAIL_API_KEY || '',
  SMTP_URL: process.env.SMTP_URL || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'no-reply@yourdomain.com',

  // Payout / Policies
  HOLD_DELAY_DAYS: parseInt(process.env.HOLD_DELAY_DAYS || '7', 10),
  MIN_PAYOUT_AMOUNT: parseFloat(process.env.MIN_PAYOUT_AMOUNT || '10.00'),
  PAYOUT_FREQUENCY_DAYS: parseInt(process.env.PAYOUT_FREQUENCY_DAYS || '7', 10),

  isDev: () => env.NODE_ENV === 'development',
  isProd: () => env.NODE_ENV === 'production',
};