import { randomUUID } from 'crypto';
import { task, logger, AbortTaskRunError } from '@trigger.dev/sdk/v3';
import { hashPassword } from 'better-auth/crypto';
import { parse } from 'csv-parse/sync';
import pool from '../lib/db';

const INSERT_BATCH_SIZE = 50;

const HASH_CONCURRENCY = 8;

const EXPECTED_HEADER_COLS = ['name', 'email', 'password', 'role'] as const;

const VALID_ROLES = ['admin', 'manager', 'student'] as const;

const NEWLINE_REGEX = /[\r\n]/;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD = {
    minLength: 8,
    hasLetter: /[a-zA-Z]/,
    hasNumber: /[0-9]/,
    hasSymbol: /[!@#$%^&*()_+\-=[\]{}|;:'",.<>?/\\~`]/,
} as const;

type BulkRow = { name: string; email: string; password: string; role: string };

type ValidationError = { row: number; field?: string; value?: string; message: string };

function hasNewline(s: string): boolean {
    return NEWLINE_REGEX.test(s);
}

/**
 * Parses a bulk user CSV string using csv-parse.
 * Expects header: name,email,password,role. Handles escaped quotes,
 * multi-line fields, and other RFC 4180 CSV edge cases.
 *
 * @param content - Raw CSV file content
 * @returns Parsed rows or error message if invalid
 */
function parseBulkCSV(
    content: string,
): { ok: true; rows: BulkRow[] } | { ok: false; error: string } {
    let records: string[][];
    try {
        records = parse(content, {
            skip_empty_lines: true,
            trim: true,
            relax_column_count: false,
        }) as string[][];
    } catch (err) {
        return {
            ok: false,
            error: `Invalid CSV: ${err instanceof Error ? err.message : 'parse error'}`,
        };
    }
    if (records.length === 0) return { ok: false, error: 'CSV is empty' };

    const headerRow = records[0];
    const headerMatch =
        headerRow?.length === 4 &&
        EXPECTED_HEADER_COLS.every(
            (col, i) => (headerRow[i] ?? '').toLowerCase() === col,
        );
    if (!headerMatch) {
        return {
            ok: false,
            error:
                'Changing header is not allowed. Use exactly: name,email,password,role (no extra columns or spaces).',
        };
    }

    const rows: BulkRow[] = [];
    for (let i = 1; i < records.length; i++) {
        const cells = records[i];
        if (!cells || cells.length !== 4) {
            return {
                ok: false,
                error: `Row ${i + 1}: exactly 4 columns required (name, email, password, role). No extra or missing columns.`,
            };
        }
        rows.push({
            name: String(cells[0] ?? '').trim(),
            email: String(cells[1] ?? '').trim().toLowerCase(),
            password: String(cells[2] ?? '').trim(),
            role: String(cells[3] ?? '').trim().toLowerCase(),
        });
    }
    return { ok: true, rows };
}

/**
 * Validates a single CSV row (name, email, password, role).
 * Enforces no newlines, valid email, password strength, and valid role.
 *
 * @param r - Parsed row to validate
 * @param rowNum - 1-based row number (for error reporting)
 * @returns Validation result with optional error details
 */
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

/**
 * Updates a bulk job record in the database.
 *
 * @param jobId - Bulk job ID
 * @param updates - Partial job fields to update (status, counts, failedRows, etc.)
 */
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

/**
 * Hashes passwords in batches with limited concurrency.
 *
 * @param rows - Objects with password field
 * @param concurrency - Max concurrent hash operations
 * @returns Array of hashed passwords in same order as input
 */
async function hashPasswordsBatched(
    rows: { password: string }[],
    concurrency: number,
): Promise<string[]> {
    const results: string[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i += concurrency) {
        const batch = rows.slice(i, i + concurrency);
        const hashed = await Promise.all(
            batch.map((r) => hashPassword(r.password)),
        );
        for (let j = 0; j < hashed.length; j++) {
            results[i + j] = hashed[j];
        }
    }
    return results;
}

/**
 * Trigger.dev task for bulk operations.
 * Dispatched by the tRPC bulk router when a bulk job is started.
 *
 * @param payload.jobId - ID of the bulk_jobs record (contains file URL and type)
 */
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

/**
 * Runs a bulk job: fetches file, parses CSV, validates, and processes.
 * Supports 'add_users' (creates users + accounts). 'add_groups' is not yet implemented.
 *
 * @param jobId - Bulk job ID from bulk_jobs table
 */
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

            const now = new Date();
            const client = await pool.connect();

            try {
                await client.query('BEGIN');
                let totalCreated = 0;

                for (
                    let batchStart = 0;
                    batchStart < validRows.length;
                    batchStart += INSERT_BATCH_SIZE
                ) {
                    const batch = validRows.slice(
                        batchStart,
                        batchStart + INSERT_BATCH_SIZE,
                    );
                    logger.info('Hashing passwords', {
                        jobId,
                        batch: batch.length,
                        totalSoFar: batchStart,
                    });
                    const hashedPasswords = await hashPasswordsBatched(
                        batch,
                        HASH_CONCURRENCY,
                    );
                    logger.info('Passwords hashed, inserting batch', {
                        jobId,
                        batchSize: batch.length,
                    });

                    const usersValues: unknown[] = [];
                    const accountsValues: unknown[] = [];
                    const usersPlaceholders: string[] = [];
                    const accountsPlaceholders: string[] = [];

                    for (let i = 0; i < batch.length; i++) {
                        const r = batch[i];
                        const userId = `user-${randomUUID()}`;
                        const accountId = `account-${randomUUID()}`;
                        const base = i * 6;
                        usersPlaceholders.push(
                            `($${base + 1}, $${base + 2}, $${base + 3}, true, $${base + 4}, $${base + 5}, $${base + 6})`,
                        );
                        usersValues.push(
                            userId,
                            r.name,
                            r.email,
                            now,
                            now,
                            r.role,
                        );
                        accountsPlaceholders.push(
                            `($${base + 1}, $${base + 2}, 'credential', $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
                        );
                        accountsValues.push(
                            accountId,
                            userId,
                            userId,
                            hashedPasswords[i],
                            now,
                            now,
                        );
                    }

                    await client.query(
                        `INSERT INTO users (id, name, email, email_verified, created_at, updated_at, role)
                         VALUES ${usersPlaceholders.join(', ')}`,
                        usersValues,
                    );
                    await client.query(
                        `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
                         VALUES ${accountsPlaceholders.join(', ')}`,
                        accountsValues,
                    );

                    totalCreated += batch.length;
                    await updateJob(jobId, { createdCount: totalCreated });
                    logger.info('Insert progress', {
                        jobId,
                        created: totalCreated,
                        total: validRows.length,
                    });
                }

                await client.query('COMMIT');
                logger.info('Insert complete', {
                    jobId,
                    created: validRows.length,
                });
                await updateJob(jobId, {
                    status: 'completed',
                    createdCount: validRows.length,
                    failedCount: 0,
                    failedRows: [],
                    errorMessage: null,
                    completedAt: new Date(),
                });
            } catch (err) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackErr) {
                    logger.warn('Rollback failed', {
                        jobId,
                        rollbackErr:
                            rollbackErr instanceof Error
                                ? rollbackErr.message
                                : String(rollbackErr),
                    });
                }
                const rawMsg =
                    err instanceof Error ? err.message : 'Transaction failed';
                const pgErr = err as { code?: string; detail?: string };
                let failedRows: { row?: number; email?: string; error: string }[] =
                    [];
                let userFriendlyMessage: string;

                const isEmailDuplicate =
                    pgErr.code === '23505' &&
                    (/email|users|users_email_unique/.test(rawMsg) ||
                        (pgErr as { constraint?: string }).constraint ===
                            'users_email_unique');
                if (isEmailDuplicate) {
                    let email: string | undefined;
                    if (pgErr.detail) {
                        const detailMatch = pgErr.detail.match(
                            /Key \(email\)=\(([^)]+)\)/i,
                        );
                        if (detailMatch) email = detailMatch[1].trim();
                    }
                    if (!email) {
                        const msgMatch = rawMsg.match(
                            /Key \(email\)=\(([^)]+)\)/i,
                        );
                        if (msgMatch) email = msgMatch[1].trim();
                    }
                    const duplicateInCsv =
                        email !== undefined
                            ? validRows
                                  .map((r, i) =>
                                      r.email.toLowerCase() === email!.toLowerCase()
                                          ? i + 2
                                          : -1,
                                  )
                                  .filter((row) => row > 0)
                            : [];
                    const isCsvDuplicate = duplicateInCsv.length > 1;

                    if (isCsvDuplicate) {
                        failedRows = duplicateInCsv.map((row) => ({
                            row,
                            email,
                            error: 'Duplicate email in CSV (same email appears multiple times)',
                        }));
                        userFriendlyMessage =
                            email !== undefined
                                ? `Duplicate email in your CSV: "${email}" appears at rows ${duplicateInCsv.join(', ')}. Remove duplicate rows and try again.`
                                : 'Duplicate email in your CSV. The same email appears multiple times. Remove duplicate rows and try again.';
                    } else {
                        const rowNum =
                            duplicateInCsv.length > 0
                                ? duplicateInCsv[0]
                                : undefined;
                        failedRows = [
                            {
                                row: rowNum,
                                email: email,
                                error: 'User with this email already exists in the system',
                            },
                        ];
                        userFriendlyMessage =
                            email !== undefined
                                ? `A user with this email already exists in the system: ${email}. Remove this row or use a different email.`
                                : 'One or more users already exist. Please remove duplicates and try again.';
                    }
                } else {
                    failedRows = [{ error: rawMsg }];
                    userFriendlyMessage =
                        'An error occurred while creating users. Please check your CSV and try again.';
                }

                try {
                    await updateJob(jobId, {
                        status: 'failed',
                        createdCount: 0,
                        failedCount: failedRows.length,
                        failedRows,
                        errorMessage: userFriendlyMessage,
                        completedAt: new Date(),
                    });
                } catch (updateErr) {
                    logger.error('Failed to update job status to failed', {
                        jobId,
                        err:
                            updateErr instanceof Error
                                ? updateErr.message
                                : String(updateErr),
                    });
                    throw updateErr;
                }
                throw new AbortTaskRunError(userFriendlyMessage);
            } finally {
                client.release();
            }
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
