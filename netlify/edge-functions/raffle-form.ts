import path from 'node:path';
import { Eta } from 'https://deno.land/x/eta@v3.1.0/src/index.ts';
import { find, pick, keyBy } from 'https://cdn.skypack.dev/lodash-es?dts';

import AirtableTable from './lib/airtable-deno.ts';

const getPrizeOptions = (meta) => {
  const entriesTable = find(meta.tables, ['name', 'Entries']);
  const prizeField = find(entriesTable.fields, ['name', 'Prize'])
  return prizeField.options.choices;
};

export default async (request: Request) => {
  const url = new URL(request.url);
  const entrantId = url.searchParams.get('recordId');

  if (!entrantId) {
    return;
  }

  const entrantsTable = new AirtableTable('raffle', 'entrants');
  const entriesTable = new AirtableTable('raffle', 'entries');

  const entrant = entrantsTable.normalize(await entrantsTable._table.find(entrantId));

  const prizes = getPrizeOptions(await entriesTable.meta());

  const entries = [];
  if (entrant.entries && entrant.entries.length) {
    for (const entryId of entrant.entries) {
      entries.push(entriesTable.normalize(await entriesTable._table.find(entryId)));
    }
  }
  const entriesCount = Object.fromEntries(entries.map(entry => (
    [find(prizes, ['name', entry.prize]).id, { quantity: entry.quantity, recordId: entry.id }]
  )));

  const eta = new Eta({ views: path.join(Deno.cwd(), 'templates') });

  const render = await eta.renderAsync('raffle-form', {
    entrant: pick(entrant, ['name', 'contact', 'numberOfEntries']),
    entries: entriesCount,
    prizes,
  });

  return new Response(render, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
};

export const config = { path: "/raffle-form" };

