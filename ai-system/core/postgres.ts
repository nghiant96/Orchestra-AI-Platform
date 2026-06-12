import { Pool, type PoolClient, type PoolConfig } from "pg";

export function createPostgresPool(config: PoolConfig = {}): Pool {
  const connectionString = process.env.ORCHESTRA_POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();
  const baseConfig: PoolConfig = {
    application_name: "orchestra-ai-platform",
    ...config
  };

  if (connectionString) {
    return new Pool({
      ...baseConfig,
      connectionString
    });
  }

  return new Pool(baseConfig);
}

export async function withPostgresClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
