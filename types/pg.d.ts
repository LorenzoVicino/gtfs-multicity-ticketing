declare module "pg" {
  export type PoolConfig = {
    connectionString?: string;
    ssl?: boolean | { rejectUnauthorized?: boolean };
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };

  export type QueryResult<T = unknown> = {
    rows: T[];
    rowCount: number;
  };

  export interface PoolClient {
    query<T = unknown>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<T = unknown>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
  }
}
