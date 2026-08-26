process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.DATA_DIR = '/tmp/dear-robot-vitest';
process.env.APP_PASSWORD = 'test-password';
process.env.APP_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
