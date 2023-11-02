import { Config, Context } from '@netlify/functions';
import { Eta } from 'eta';
import _ from 'lodash';

import AirtableBase from '../lib/airtable.mjs';
import { FieldSet } from 'airtable';

const getEntriesByEntrant = async (entrantId: string) => {
  const entriesTable = new AirtableBase('raffle').table('entries');

  const entries = await entriesTable._table.select({
    filterByFormula: `entrantId = '${entrantId}'`,
  }).all()

  return entries?.map(entriesTable.normalize);
}

export default async (request: Request, context: Context) => {
  const form = await request.formData();
  const data = {};
  for (const [key, value] of form.entries()) {
    const transformedValue = key.startsWith('prizes[') ? parseInt(value) : value;
    _.set(data, key, transformedValue);
  }

  const { entrantId, prizes } = data as {
    entrantId: string,
    prizes: Record<string, number>,
    [key: string]: any,
  };

  if (!entrantId) {
    return;
  }

  const raffleBase = new AirtableBase('raffle');
  const entrantsTable = raffleBase.table('entrants');
  const entriesTable = raffleBase.table('entries');

  const entrant = entrantsTable.normalize(await entrantsTable._table.find(entrantId));
  if (!entrant) {
    return;
  }

  const entries = await getEntriesByEntrant(entrantId);

  const updates: FieldSet[] = [];
  for (const entry of entries) {
    const prizeId = entry.prize[0];
    if (prizeId in prizes) {
      if (prizes[prizeId] !== entry.quantity) {
        updates.push({
          id: entry.id,
          fields: entriesTable.denormalize({
            quantity: prizes[prizeId]
          }),
        });
      }
      Reflect.deleteProperty(prizes, prizeId);
    }
  }

  const creates: FieldSet[] = [];
  for (const [prizeId, quantity] of Object.entries(prizes)) {
    if (quantity > 0) {
      creates.push({
        fields: entriesTable.denormalize({
          entrant: [entrantId],
          prize: [prizeId],
          quantity,
        }),
      });
    }
    Reflect.deleteProperty(prizes, prizeId);
  }

  let results: any = {};
  if (updates.length) {
    if (updates.length > 10) {
      throw new Error('TODO handle big update');
    }
    const updateResults = await entriesTable._table.update(updates);
    results.updates = updateResults;
  }
  if (creates.length) {
    if (creates.length > 10) {
      throw new Error('TODO handle big create');
    }
    const createResults = await entriesTable._table.create(creates);
    results.creates = createResults;
  }

  return Response.redirect(`${context.site.url}/raffle-form?recordId=${entrantId}&success=true`);
}

export const config: Config = {
  method: 'POST',
  path: '/raffle-form/submit'
};
