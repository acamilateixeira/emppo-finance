import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';

const income = { name: 'Venda de teste', amountCents: 30000, direction: 'income', occurredOn: '2026-03-01' };

test('persists entries and returns filtered results and totals in cents', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'emppo-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, 'ledger.sqlite');
  const writer = buildApp(file);
  try {
    const result = await writer.inject({ method: 'POST', url: '/api/entries', payload: income });
    assert.equal(result.statusCode, 201);
    assert.equal(result.json().amountCents, income.amountCents);

    const expense = await writer.inject({
      method: 'POST', url: '/api/entries',
      payload: { ...income, name: 'Despesa de teste', amountCents: 7250, direction: 'expense' },
    });
    assert.equal(expense.statusCode, 201);
  } finally {
    await writer.close();
  }

  const reader = buildApp(file);
  try {
    const filtered = await reader.inject('/api/entries?direction=expense');
    assert.equal(filtered.statusCode, 200);
    assert.deepEqual(filtered.json().entries.map((entry: { name: string }) => entry.name), ['Despesa de teste']);

    const summary = await reader.inject('/api/summary');
    assert.deepEqual(summary.json(), { incomeCents: 30000, expenseCents: 7250, balanceCents: 22750 });
  } finally {
    await reader.close();
  }
});

test('rejects invalid amount, direction, date and name before recording an entry', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  for (const fields of [
    { amountCents: 1.5 },
    { amountCents: -1 },
    { amountCents: '100' },
    { direction: 'transfer' },
    { occurredOn: '2026-02-31' },
    { name: '   ' },
  ]) {
    const result = await app.inject({ method: 'POST', url: '/api/entries', payload: { ...income, ...fields } });
    assert.equal(result.statusCode, 400, JSON.stringify(fields));
  }
  assert.deepEqual((await app.inject('/api/entries')).json(), { entries: [] });
});
