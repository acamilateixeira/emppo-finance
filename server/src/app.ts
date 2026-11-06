import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';

type Direction = 'income' | 'expense';
type EntryInput = { name: string; amountCents: number; direction: Direction; occurredOn: string };

const direction = { type: 'string', enum: ['income', 'expense'] };
const entrySchema = {
  type: 'object',
  required: ['name', 'amountCents', 'direction', 'occurredOn'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    amountCents: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
    direction,
    occurredOn: { type: 'string', format: 'date' },
  },
};

export function buildApp(databasePath = ':memory:') {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    create table if not exists entries (
      id text primary key,
      name text not null,
      amount_cents integer not null check (amount_cents > 0),
      direction text not null check (direction in ('income', 'expense')),
      occurred_on text not null
    ) strict
  `);
  const insert = db.prepare(`
    insert into entries (id, name, amount_cents, direction, occurred_on)
    values (?, ?, ?, ?, ?)
  `);
  const list = db.prepare(`
    select id, name, amount_cents as amountCents, direction, occurred_on as occurredOn
    from entries
    where (? is null or direction = ?)
    order by occurred_on desc, id
    limit 100
  `);
  const summary = db.prepare(`
    select coalesce(sum(case when direction = 'income' then amount_cents end), 0) as incomeCents,
           coalesce(sum(case when direction = 'expense' then amount_cents end), 0) as expenseCents
    from entries
  `);

  const app = Fastify({ ajv: { customOptions: { coerceTypes: false } } });
  app.addHook('onClose', async () => db.close());
  app.get('/health', async () => ({ status: 'ok' }));
  app.get<{ Querystring: { direction?: Direction } }>('/api/entries', {
    schema: { querystring: { type: 'object', properties: { direction }, additionalProperties: false } },
  }, async ({ query }) => {
    const filter = query.direction ?? null;
    return { entries: list.all(filter, filter) };
  });
  app.post<{ Body: EntryInput }>('/api/entries', {
    schema: { body: entrySchema },
  }, async ({ body }, reply) => {
    const entry = { ...body, name: body.name.trim(), id: randomUUID() };
    insert.run(entry.id, entry.name, entry.amountCents, entry.direction, entry.occurredOn);
    return reply.code(201).send(entry);
  });
  app.get('/api/summary', async () => {
    const totals = summary.get();
    const incomeCents = Number(totals?.incomeCents ?? 0);
    const expenseCents = Number(totals?.expenseCents ?? 0);
    return { incomeCents, expenseCents, balanceCents: incomeCents - expenseCents };
  });
  return app;
}
