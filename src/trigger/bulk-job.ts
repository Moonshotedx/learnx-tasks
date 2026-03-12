import { task, logger } from '@trigger.dev/sdk/v3';
import { randomUUID } from 'crypto';
import { hashPassword } from 'better-auth/crypto';
import pool from '../lib/db';

const PROGRESS_UPDATE_INTERVAL = 50;

// Match src/lib/validations/user.ts and src/app/admin/components/user-management/bulk-csv-utils.ts exactly
const EXPECTED_HEADER = 'name,email,password,role';
const VALID_ROLES = ['admin', 'manager', 'student'] as const;
const NEWLINE_REGEX = /[\r\n]/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD = {
    minLength: 8,
    hasLetter: /[a-zA-Z]/,
    hasNumber: /[0-9]/,
    hasSymbol: /[!@#$%^&*()_+\-=[\]{}|;:'",.<>?/\\~`]/,
} as const;

function hasNewline(s: string): boolean {
    return NEWLINE_REGEX.test(s);
}

function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    fields.push(current.trim());
    return fields;
}

type BulkRow = { name: string; email: string; password: string; role: string };
type ValidationError = { row: number; field?: string; value?: string; message: string };

function parseBulkCSV(
    content: string,
): { ok: true; rows: BulkRow[] } | { ok: false; error: string } {
    const lines = content.split(/\r?\n/).map((l) => l.trim());
    const nonEmpty = lines.filter((l) => l.length > 0);
    if (nonEmpty.length === 0) return { ok: false, error: 'CSV is empty' };

    const headerLine = nonEmpty[0];
    if (headerLine !== EXPECTED_HEADER) {
        return {
            ok: false,
            error:
                'Changing header is not allowed. Use exactly: name,email,password,role (no extra columns or spaces).',
        };
    }

    const rows: BulkRow[] = [];
    for (let i = 1; i < nonEmpty.length; i++) {
        const line = nonEmpty[i];
        if (!line.trim()) continue;
        const cells = parseCSVLine(line);
        if (cells.length !== 4) {
            return {
                ok: false,
                error: `Row ${i + 1}: exactly 4 columns required (name, email, password, role). No extra or missing columns.`,
            };
        }
        rows.push({
            name: String(cells[0] ?? '').trim(),
            email: String(cells[1] ?? '').trim(),
            password: String(cells[2] ?? '').trim(),
            role: String(cells[3] ?? '').trim().toLowerCase(),
        });
    }
    return { ok: true, rows };
}

function validateRow(
    r: BulkRow,
    rowNum: number,
): { valid: true } | { valid: false; error: ValidationError } {
    if (hasNewline(r.name)) {
        return {
            valid: false,
            error: { row: rowNum, field: 'name', message: 'New lines are not allowed' },
        };
    }
    if (!r.name.trim()) {
        return {
            valid: false,
            error: { row: rowNum, field: 'name', message: 'Name is required' },
        };
    }
    if (hasNewline(r.email)) {
        return {
            valid: false,
            error: { row: rowNum, field: 'email', message: 'New lines are not allowed' },
        };
    }
    if (!r.email.trim()) {
        return {
            valid: false,
            error: { row: rowNum, field: 'email', message: 'Email is required' },
        };
    }
    if (!EMAIL_REGEX.test(r.email.trim())) {
        return {
            valid: false,
            error: {
                row: rowNum,
                field: 'email',
                value: r.email,
                message: 'Invalid email format',
            },
        };
    }
    if (hasNewline(r.password)) {
        return {
            valid: false,
            error: { row: rowNum, field: 'password', message: 'New lines are not allowed' },
        };
    }
    if (r.password.length < PASSWORD.minLength) {
        return {
            valid: false,
            error: {
                row: rowNum,
                field: 'password',
                message: 'Password must be at least 8 characters',
            },
        };
    }
    if (!PASSWORD.hasLetter.test(r.password)) {
        return {
            valid: false,
            error: {
                row: rowNum,
                field: 'password',
                message: 'Password must contain at least one letter',
            },
        };
    }
    if (!PASSWORD.hasNumber.test(r.password)) {
        return {
            valid: false,
            error: {
                row: rowNum,
                field: 'password',
                message: 'Password must contain at least one number',
            },
        };
    }
    if (!PASSWORD.hasSymbol.test(r.password)) {
        return {
            valid: false,
            error: {
                row: rowNum,
                field: 'password',
                message: 'Password must contain at least one symbol',
            },
        };
    }
    if (!VALID_ROLES.includes(r.role as (typeof VALID_ROLES)[number])) {
        return {
            valid: false,
            error: {
                row: rowNum,
                field: 'role',
                value: r.role,
                message: 'Role must be admin, manager, or student',
            },
        };
    }
    return { valid: true };
}

async function updateJob(
    jobId: number,
    updates: {
        status?: string;
        totalRows?: number;
        createdCount?: number;
        failedCount?: number;
        failedRows?: unknown;
        errorMessage?: string | null;
        completedAt?: Date | null;
    },
) {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (updates.status !== undefined) {
        sets.push(`status = $${i++}`);
        values.push(updates.status);
    }
    if (updates.totalRows !== undefined) {
        sets.push(`total_rows = $${i++}`);
        values.push(updates.totalRows);
    }
    if (updates.createdCount !== undefined) {
        sets.push(`created_count = $${i++}`);
        values.push(updates.createdCount);
    }
    if (updates.failedCount !== undefined) {
        sets.push(`failed_count = $${i++}`);
        values.push(updates.failedCount);
    }
    if (updates.failedRows !== undefined) {
        sets.push(`failed_rows = $${i++}`);
        values.push(JSON.stringify(updates.failedRows));
    }
    if (updates.errorMessage !== undefined) {
        sets.push(`error_message = $${i++}`);
        values.push(updates.errorMessage);
    }
    if (updates.completedAt !== undefined) {
        sets.push(`completed_at = $${i++}`);
        values.push(updates.completedAt);
    }
    if (sets.length === 0) return;
    values.push(jobId);
    await pool.query(
        `UPDATE bulk_jobs SET ${sets.join(', ')} WHERE id = $${i}`,
        values,
    );
}

export const bulkJobTask = task({
    id: 'bulk-job',
    run: async (payload: { jobId: number }) => {
        const { jobId } = payload;
        try {
            await runBulkJob(jobId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Task failed';
            await updateJob(jobId, {
                status: 'failed',
                errorMessage: msg,
                completedAt: new Date(),
            });
            throw err;
        }
    },
});

async function runBulkJob(jobId: number) {
    logger.info('Bulk job started', { jobId });

    const jobRes = await pool.query(
            'SELECT id, type, file_url, status FROM bulk_jobs WHERE id = $1',
            [jobId],
        );
        const job = jobRes.rows[0];
        if (!job) {
            throw new Error(`Bulk job ${jobId} not found`);
        }
        if (job.status !== 'pending') {
            throw new Error(`Bulk job ${jobId} is not pending`);
        }

        const fileUrl = job.file_url;
        const jobType = job.type as string;
        logger.info('Fetching CSV from R2', { jobId, jobType });

        let csvText: string;
        try {
            const resp = await fetch(fileUrl);
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
            }
            csvText = await resp.text();
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : 'Failed to fetch file';
            await updateJob(jobId, {
                status: 'failed',
                errorMessage: `Failed to fetch file: ${msg}`,
                completedAt: new Date(),
            });
            return;
        }

        logger.info('CSV fetched, parsing', { jobId, sizeBytes: csvText.length });

        const parseResult = parseBulkCSV(csvText);
        if (!parseResult.ok) {
            await updateJob(jobId, {
                status: 'failed',
                errorMessage: parseResult.error,
                completedAt: new Date(),
            });
            return;
        }

        const rows = parseResult.rows;
        logger.info('CSV parsed, validating rows', { jobId, rowCount: rows.length });

        const validationErrors: ValidationError[] = [];
        const validRows: (BulkRow & { role: (typeof VALID_ROLES)[number] })[] =
            [];

        for (let i = 0; i < rows.length; i++) {
            const rowNum = i + 2;
            const result = validateRow(rows[i], rowNum);
            if (result.valid) {
                validRows.push({
                    ...rows[i],
                    role: rows[i].role as (typeof VALID_ROLES)[number],
                });
            } else {
                validationErrors.push(result.error);
            }
        }

        if (validationErrors.length > 0) {
            await updateJob(jobId, {
                status: 'failed',
                totalRows: rows.length,
                createdCount: 0,
                failedCount: validationErrors.length,
                failedRows: validationErrors,
                errorMessage: `${validationErrors.length} validation error(s)`,
                completedAt: new Date(),
            });
            return;
        }

        logger.info('Validation passed, starting processing', { jobId, validRows: validRows.length });

        await updateJob(jobId, {
            status: 'processing',
            totalRows: validRows.length,
        });

        if (jobType === 'add_users') {
            logger.info('Checking for duplicate emails', { jobId });
            const emails = validRows.map((r) => r.email);
            const existingRes = await pool.query(
                'SELECT email FROM users WHERE email = ANY($1::text[])',
                [emails],
            );
            const existingEmails = new Set(
                existingRes.rows.map((r: { email: string }) => r.email),
            );
            const duplicateRows: { row: number; email: string; error: string }[] =
                [];
            validRows.forEach((r, i) => {
                if (existingEmails.has(r.email)) {
                    duplicateRows.push({
                        row: i + 2,
                        email: r.email,
                        error: 'Email already exists',
                    });
                }
            });
            if (duplicateRows.length > 0) {
                await updateJob(jobId, {
                    status: 'failed',
                    createdCount: 0,
                    failedCount: duplicateRows.length,
                    failedRows: duplicateRows,
                    errorMessage: `Duplicate email: ${duplicateRows[0].email} at row ${duplicateRows[0].row}`,
                    completedAt: new Date(),
                });
                return;
            }

            logger.info('Hashing passwords', { jobId, count: validRows.length });
            const hashedPasswords = await Promise.all(
                validRows.map((r) => hashPassword(r.password)),
            );
            logger.info('Passwords hashed, inserting users', { jobId });

            const now = new Date();
            const client = await pool.connect();

            try {
                await client.query('BEGIN');
                for (let i = 0; i < validRows.length; i++) {
                    const r = validRows[i];
                    const userId = `user-${randomUUID()}`;
                    const accountId = `account-${randomUUID()}`;
                    await client.query(
                        `INSERT INTO users (id, name, email, email_verified, created_at, updated_at, role)
                         VALUES ($1, $2, $3, true, $4, $5, $6)`,
                        [userId, r.name, r.email, now, now, r.role],
                    );
                    await client.query(
                        `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
                         VALUES ($1, $2, 'credential', $3, $4, $5, $6)`,
                        [accountId, userId, userId, hashedPasswords[i], now, now],
                    );
                    if ((i + 1) % PROGRESS_UPDATE_INTERVAL === 0) {
                        await updateJob(jobId, { createdCount: i + 1 });
                        logger.info('Insert progress', { jobId, created: i + 1, total: validRows.length });
                    }
                }
                await client.query('COMMIT');
                logger.info('Insert complete', { jobId, created: validRows.length });
            } catch (err) {
                await client.query('ROLLBACK');
                const msg =
                    err instanceof Error ? err.message : 'Transaction failed';
                let failedRows: { row?: number; email?: string; error: string }[] =
                    [];
                const dupMatch = msg.match(
                    /duplicate key.*?\(([^)]+)\)/i,
                );
                if (dupMatch && /email|users/.test(msg)) {
                    const email = dupMatch[1].trim();
                    const idx = validRows.findIndex((r) => r.email === email);
                    failedRows = [
                        {
                            row: idx >= 0 ? idx + 2 : undefined,
                            email,
                            error: 'Email already exists',
                        },
                    ];
                } else {
                    failedRows = [{ error: msg }];
                }
                await updateJob(jobId, {
                    status: 'failed',
                    createdCount: 0,
                    failedCount: failedRows.length,
                    failedRows,
                    errorMessage: msg,
                    completedAt: new Date(),
                });
                return;
            } finally {
                client.release();
            }

            await updateJob(jobId, {
                status: 'completed',
                createdCount: validRows.length,
                failedCount: 0,
                failedRows: [],
                errorMessage: null,
                completedAt: new Date(),
            });
        } else if (jobType === 'add_groups') {
            await updateJob(jobId, {
                status: 'failed',
                errorMessage: `Unsupported bulk type: ${jobType}`,
                completedAt: new Date(),
            });
        } else {
            await updateJob(jobId, {
                status: 'failed',
                errorMessage: `Unknown bulk type: ${jobType}`,
                completedAt: new Date(),
            });
        }
}
