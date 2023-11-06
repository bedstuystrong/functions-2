import { Config, Context } from '@netlify/functions';
import path from 'node:path';
import { Eta } from 'eta';
import _ from 'lodash';

import AirtableBase from '../lib/airtable.mjs';

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const entrantId = url.searchParams.get('recordId');

  if (!entrantId) {
    return;
  }

  const raffleBase = new AirtableBase('raffle');
  const entrantsTable = raffleBase.table('entrants');
  const entriesTable = raffleBase.table('entries');
  const prizesTable = raffleBase.table('prizes');

  const entrant = entrantsTable.normalize(await entrantsTable._table.find(entrantId));

  const prizes = (await prizesTable._table.select({
    sort: [{ field: 'Order', direction: 'asc' }]
  }).all()).map(prizesTable.normalize);

  if (!prizes) {
    return;
  }

  const entries = [];
  if (entrant.entries && entrant.entries.length) {
    for (const entryId of entrant.entries) {
      entries.push(entriesTable.normalize(await entriesTable._table.find(entryId)));
    }
  }
  const entriesCount = Object.fromEntries(entries.map(entry => (
    [entry.prizeId[0], { quantity: entry.quantity, recordId: entry.id }]
  )));

  const eta = new Eta({ views: path.resolve(process.cwd(), 'templates') });

  const render = await eta.renderAsync('raffle-form', {
    entrantId,
    entrant: _.pick(entrant, ['name', 'contact', 'numberOfEntries']),
    entries: entriesCount,
    prizes,
  });

  return new Response(render, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })
};

export const config: Config = {
  method: 'GET',
  path: '/raffle-form'
};
