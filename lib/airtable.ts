import fs from 'node:fs';
import path from 'node:path';
import Airtable from 'airtable';
import _ from 'lodash';
import invariant from 'tiny-invariant';

import { isNodeError } from './util';

interface AirtableTableSchema {
  [key: string]: string;
}

interface AirtableTableConfig {
  key: string;
  name: string;
  schema: AirtableTableSchema;
}

interface AirtableBaseConfig {
  id: string;
  key: string;
  tables: AirtableTableConfig[];
}

interface AirtableConfig {
  bases: AirtableBaseConfig[];
}

interface NormalizedAirtableRecord {
  id: string;
  _record: Airtable.Record<Airtable.FieldSet>;
  _meta?: Record<string, any> | null;
  [key: string]: any;
}

interface RecordCreateOptionalParameters {
  typecast?: boolean;
}

export default class AirtableBase {
  client: Airtable;
  config: AirtableBaseConfig;
  _base: Airtable.Base;

  constructor(baseKey: string, config?: AirtableConfig) {
    if (!config) {
      try {
        const configFile = fs.readFileSync(path.resolve(process.cwd(), 'airtable.config.json'), 'utf8');
        config = JSON.parse(configFile);
      } catch (error) {
        const isENOENT = isNodeError(error) && error.code === 'ENOENT';
        const errorMessage = isENOENT ? `Missing Airtable config: Can't find default config file airtable.config.json` : error;
        throw new Error(errorMessage);
      }
    }

    this.client = new Airtable({
      apiKey: process.env.AIRTABLE_API_KEY,
    });

    this.config = _.find(config.bases, ['key', baseKey]);
    invariant(this.config, `could not find base with key "${baseKey}" in config`);

    this._base = this.client.base(this.config.id);
  }

  table = (tableKey: string) => {
    return new AirtableTable(this, tableKey);
  }
}

class AirtableTable {
  client: Airtable;
  config: AirtableTableConfig;
  base: AirtableBase;
  _table: Airtable.Table<Airtable.FieldSet>;

  constructor(base: AirtableBase, tableKey: string) {
    this.base = base;
    this.client = this.base.client;

    this.config = _.find(this.base.config.tables, ['key', tableKey]);
    invariant(this.config, `could not find table with key "${tableKey}" in base "${this.base.config.key}" config`);

    this._table = this.base._base(this.config.name);
  }

  create = async (
    data: Record<string, any> | Record<string, any>[],
    params?: RecordCreateOptionalParameters
  ): Promise<NormalizedAirtableRecord | NormalizedAirtableRecord[]> => {
    const payload = Array.isArray(data) ? data.map((fields) => ({
      fields: this.denormalize(fields),
    })) : this.denormalize(data);
    // @ts-ignore-error FIXME
    const result = await this._table.create(payload, {
      typecast: true,
      ...params,
    });
    // @ts-ignore-error FIXME
    return Array.isArray(result) ? result.map(this.normalize) : this.normalize(result);
  }

  normalize = (record: Airtable.Record<Airtable.FieldSet>): NormalizedAirtableRecord => {
    const fields = { ...record.fields };
    const invertedSchema = _.invert(this.config.schema);

    const recordBase = { id: record.id, _record: record } as NormalizedAirtableRecord;
    if (fields._meta) {
      recordBase._meta = JSON.parse(fields._meta as string);
      Reflect.deleteProperty(fields, '_meta');
    }

    const normalizedFields = _.mapKeys(fields, (_value, key) => (invertedSchema[key] || key));

    return _.assign(
      recordBase,
      _.mapValues(this.config.schema, () => null), // Airtable.Record doesn't include empty fields
      normalizedFields,
    );
  };

  denormalize = (object: Record<string, any>) => {
    // Remove null keys and map back to original schema
    const denormalized = _.mapKeys(
      _.pickBy(object, (value) => !_.isNull(value)),
      (_value, key) => (this.config.schema[key] || key)
    );

    if (denormalized._meta) {
      denormalized._meta = JSON.stringify(denormalized._meta);
    }

    return denormalized;
  };
}