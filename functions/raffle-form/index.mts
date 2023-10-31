import { Config, Context } from '@netlify/functions';
import path from 'node:path';
import { Eta } from 'eta';
import _ from 'lodash';

import AirtableBase from '../../lib/airtable.mjs';

const getPrizeOptions = (meta) => {
  const entriesTable = _.find(meta.tables, ['name', 'Entries']);
  const prizeField = _.find(entriesTable?.fields, ['name', 'Prize'])
  return prizeField?.options?.choices;
};

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const entrantId = url.searchParams.get('recordId');

  if (!entrantId) {
    return;
  }

  const raffleBase = new AirtableBase('raffle');
  const entrantsTable = raffleBase.table('entrants');
  const entriesTable = raffleBase.table('entries');

  const entrant = entrantsTable.normalize(await entrantsTable._table.find(entrantId));

  const prizes = getPrizeOptions(await raffleBase.meta());

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
    [_.find(prizes, ['name', entry.prize]).id, { quantity: entry.quantity, recordId: entry.id }]
  )));

  const eta = new Eta({ views: path.resolve(process.cwd(), 'templates') });

  const render = await eta.renderAsync('raffle-form', {
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