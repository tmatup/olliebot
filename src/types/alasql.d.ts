declare module 'alasql' {
  interface AlaSQL {
    (sql: string, params?: unknown[]): unknown[];
    (sql: string): unknown[];
  }

  const alasql: AlaSQL;
  export default alasql;
}
