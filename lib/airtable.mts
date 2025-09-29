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

export interface NormalizedAirtableRecord {
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
        invariant(config, 'config cannot be empty');
      } catch (error) {
        const isENOENT = isNodeError(error) && error.code === 'ENOENT';
        const errorMessage = isENOENT ? `Missing Airtable config: Can't find default config file airtable.config.json` : error;
        throw new Error(errorMessage);
      }
    }

    this.client = new Airtable({
      apiKey: Netlify.env.get('AIRTABLE_API_KEY'),
    });

    const baseConfig = _.find(config.bases, ['key', baseKey]);
    invariant(baseConfig, `could not find base with key '${baseKey}' in config`);
    this.config = baseConfig;

    this._base = this.client.base(this.config.id);
  }

  meta = async (): Promise<any> => {
    const apiBase = `${this.client._endpointUrl}/v${this.client._apiVersionMajor}`;
    const url = `${apiBase}/meta/bases/${this.config.id}/tables`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.client._apiKey}`,
      },
    });

    return response.json();
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

    const config = _.find(this.base.config.tables, ['key', tableKey]);
    invariant(config, `could not find table with key '${tableKey}' in base '${this.base.config.key}' config`);
    this.config = config;

    this._table = this.base._base(this.config.name);
  }

  create = async (
    data: Record<string, any> | Record<string, any>[],
    params?: RecordCreateOptionalParameters
  ): Promise<NormalizedAirtableRecord | NormalizedAirtableRecord[]> => {
    const payload = Array.isArray(data)
      ? data.map((fields) => ({
          fields: this.denormalize(fields),
        }))
      : this.denormalize(data);
    try {
      // @ts-ignore-error FIXME
      const result = await this._table.create(payload, {
        typecast: true,
        ...params,
      });
      return Array.isArray(result)
        ? result.map(this.normalize)
        : // @ts-ignore-error FIXME
          this.normalize(result);
    } catch (error) {
      if (error instanceof Airtable.Error) {
        throw AirtableStackError.fromAirtableError(error);
      } else {
        throw error;
      }
    }
  };

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

// wrap AirtableError with a stack trace (https://github.com/netlify/cli/issues/6215)
export class AirtableStackError extends Airtable.Error {
  stack: string;

  constructor(error: string, message: string, statusCode: number) {
    super(error, message, statusCode);
    Error.captureStackTrace(this, AirtableStackError);
  }

  static fromAirtableError(error: Airtable.Error) {
    return new AirtableStackError(error.error, error.message, error.statusCode);
  }
}
