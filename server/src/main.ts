import { buildApp } from './app.ts';

const app = buildApp(process.env.EMPPO_DATABASE_PATH || 'emppo.sqlite');

try {
  const address = await app.listen({ host: '127.0.0.1', port: 3001 });
  console.log(`Emppo API: ${address}`);
} catch (error) {
  await app.close();
  throw error;
}
