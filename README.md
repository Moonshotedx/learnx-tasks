# learnx-tasks

Cron and background tasks for learnx.

## Setup

Tasks need `DATABASE_URL` to connect to the database. For local dev:

```bash
# Option 1: Symlink from parent project
ln -s ../.env .env

# Option 2: Copy required vars
cp sample.env .env
# Then add DATABASE_URL from the main learnx .env
```

Then run `pnpm dev` to start the Trigger.dev worker.
