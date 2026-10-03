#!/bin/sh
# With arguments, runs them (the deploy runs the migration this way: `docker compose run ... npm run
# db:migrate`). Without, serves. The migration is a separate step so that it happens before the new
# version starts and a failed one stops the deploy; it runs in one transaction under an advisory
# lock, so a failed migration leaves the database as it was.
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec ./node_modules/.bin/next start --hostname 0.0.0.0 --port 3000
