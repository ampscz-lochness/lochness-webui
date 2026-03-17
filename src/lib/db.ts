import { Pool } from 'pg';

let connection: Pool | undefined;

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "require"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disable"].includes(normalized)) return false;
    return undefined;
};

if (!connection) {
    // Check if the environment variables are set
    if (!process.env.PG_user || !process.env.PG_host || !process.env.PG_database || !process.env.PG_password) {
        throw new Error("Missing required environment variables for database connection");
    }

    const sslFromEnv = parseBooleanEnv(process.env.PG_ssl);
    const useSsl = sslFromEnv ?? process.env.NODE_ENV === "production";

    connection = new Pool({
        user: process.env.PG_user,
        host: process.env.PG_host,
        database: process.env.PG_database,
        password: process.env.PG_password,
        port: process.env.PG_port ? parseInt(process.env.PG_port, 10) : undefined,
        ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
}

/**
 * Retrieves the established database connection pool.
 *
 * @returns The database connection pool instance.
 * @throws {Error} If the database connection has not been initialized before calling this function.
 */
export function getConnection(): Pool {
    if (!connection) {
        throw new Error("Database connection is undefined");
    }
    return connection;
}

export default connection;
