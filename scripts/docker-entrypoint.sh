#!/bin/sh
# Migrates the database, then serves. The migration runs in one transaction under an advisory lock:
# if it fails the container exits and the database is as it was. Compose stops the old container
# before it starts a new one, so no older release is serving while this runs.
set -e

npm run db:migrate
exec ./node_modules/.bin/next start --hostname 0.0.0.0 --port 3000
