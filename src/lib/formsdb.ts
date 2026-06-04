import { Pool } from "pg";

let formsConnection: Pool | undefined;

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "require"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disable"].includes(normalized)) return false;
    return undefined;
};

if (!formsConnection) {
    const user = process.env.FORMS_PG_user ?? process.env.PG_user;
    const host = process.env.FORMS_PG_host ?? process.env.PG_host;
    const password = process.env.FORMS_PG_password ?? process.env.PG_password;
    const database = process.env.FORMS_PG_database ?? "formsdb";
    const port = process.env.FORMS_PG_port ?? process.env.PG_port;
    const sslEnv = process.env.FORMS_PG_ssl ?? process.env.PG_ssl;

    if (!user || !host || !password) {
        throw new Error("Missing required environment variables for forms database connection");
    }

    const sslFromEnv = parseBooleanEnv(sslEnv);
    const useSsl = sslFromEnv ?? process.env.NODE_ENV === "production";

    formsConnection = new Pool({
        user,
        host,
        password,
        database,
        port: port ? parseInt(port, 10) : undefined,
        ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
}

export function getFormsConnection(): Pool {
    if (!formsConnection) {
        throw new Error("Forms database connection is undefined");
    }
    return formsConnection;
}
