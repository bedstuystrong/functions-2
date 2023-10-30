import path from 'node:path';
import { Airtable } from 'https://deno.land/x/airtable/mod.ts';
// @deno-types="https://cdn.skypack.dev/@types/lodash?dts"
import { find, invert, assign, mapKeys, mapValues, pickBy, isNull } from 'https://cdn.skypack.dev/lodash-es?dts';
import invariant from 'https://deno.land/x/invariant@1.0.4/mod.ts';

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

export default class AirtableTable {
  config: AirtableTableConfig;
  baseConfig: AirtableBaseConfig;
  _table: Airtable.Table<Airtable.FieldSet>;

  constructor(baseKey: string, tableKey: string, config?: AirtableConfig) {
    if (!config) {
      try {
        const configFile = Deno.readTextFileSync(path.resolve(Deno.cwd(), 'airtable.config.json'));
        config = JSON.parse(configFile);
      } catch (error) {
        const errorMessage = error === Deno.errors.NotFound ? `Missing Airtable config: Can't find default config file airtable.config.json` : error;
        throw new Error(errorMessage);
      }
    }

    this.baseConfig = find(config.bases, ['key', baseKey]);
    invariant(this.baseConfig, `could not find base with key "${baseKey}" in config`);
    this.config = find(this.baseConfig.tables, ['key', tableKey]);
    invariant(this.config, `could not find table with key "${tableKey}" in base "${this.baseConfig.key}" config`);

    this._table = new Airtable({
      apiKey: Deno.env.get('AIRTABLE_API_KEY'),
      baseId: this.baseConfig.id,
      tableName: this.config.name
    });
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

  meta = async (): Promise<any> => {
    const endpointUrl = Airtable.defaultOptions.endpointUrl;
    const url = `${endpointUrl}/meta/bases/${this.baseConfig.id}/tables`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${Deno.env.get('AIRTABLE_API_KEY')}`,
      },
    });

    return response.json();
  }

  normalize = (record: Airtable.Record<Airtable.FieldSet>): NormalizedAirtableRecord => {
    const fields = { ...record.fields };
    const invertedSchema = invert(this.config.schema);

    const recordBase = { id: record.id, _record: record } as NormalizedAirtableRecord;
    if (fields._meta) {
      recordBase._meta = JSON.parse(fields._meta as string);
      Reflect.deleteProperty(fields, '_meta');
    }

    const normalizedFields = mapKeys(fields, (_value: any, key: string) => (invertedSchema[key] || key));

    return assign(
      recordBase,
      mapValues(this.config.schema, (): null => null), // Airtable.Record doesn't include empty fields
      normalizedFields,
    );
  };

  denormalize = (object: Record<string, any>) => {
    // Remove null keys and map back to original schema
    const denormalized = mapKeys(
      pickBy(object, (value: any) => !isNull(value)),
      (_value: any, key: string) => (this.config.schema[key] || key)
    );

    if (denormalized._meta) {
      denormalized._meta = JSON.stringify(denormalized._meta);
    }

    return denormalized;
  };
}