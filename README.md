# functions-2

serverless functions, again

## airtable module

this includes a work-in-progress module that acts as a layer over airtable, with
the goal of making it easier to juggle multiple bases, tables, and their
schemas.

- refer to bases and tables by machine-readable key (i.e. snakeCase) instead of
  unique ID or human-readable name
- normalize and denormalize records and field keys to make them easier to work
  with in javascript (i.e. object dot notation instead of bracket notation)
  - also has the side effect of making it easier to update your code if a field
    name changes in Airtable
- base `meta` API not found in official library
