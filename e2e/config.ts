// Shared E2E constants. Tests run against an isolated `toto_e2e` database and a
// dedicated dev server on PORT, so they never touch local dev data.
export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE_URL = "postgres://toto:toto@localhost:5433/toto_e2e";
export const ADMIN_DB_URL = "postgres://toto:toto@localhost:5433/postgres";
