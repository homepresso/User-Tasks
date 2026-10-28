# Event-driven ETL

Load each new staged order into the warehouse with normalisation, currency conversion and a load status.

## What's inside

- **Load staged order** workflow (data-table event: row created in Orders staging)
- **Orders staging** data table (the input queue) and **Currency rates** data table with six sample rates
- **Data warehouse** REST integration with *Ingest order*

## After installing

1. Complete setup: the warehouse base URL and API token.
2. Insert a row into **Orders staging** to load it, for example from another workflow (Data table step, insert) or the API.
