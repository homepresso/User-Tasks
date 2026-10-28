// Optional database drivers (optionalDependencies). Typed loosely so the app
// typechecks and builds whether or not they are installed; lib/db-connector
// loads them through loadOptionalDriver().
declare module 'oracledb'
declare module 'snowflake-sdk'
declare module 'mongodb'
