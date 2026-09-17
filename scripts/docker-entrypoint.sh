#!/bin/sh
set -eu

CONFIG_DIR=${CASHIER_CONFIG_DIR:-/app/config}
mkdir -p "$CONFIG_DIR"

load_or_create_secret() {
    explicit_value=$1
    secret_file=$2
    if [ -n "$explicit_value" ]; then
        printf '%s' "$explicit_value"
        return
    fi
    if [ ! -s "$secret_file" ]; then
        temporary_file="${secret_file}.tmp.$$"
        node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" > "$temporary_file"
        chmod 600 "$temporary_file"
        mv "$temporary_file" "$secret_file"
    fi
    tr -d '\r\n' < "$secret_file"
}

AUTH_SECRET=$(load_or_create_secret "${AUTH_SECRET:-}" "$CONFIG_DIR/auth-secret")
API_KEY_PEPPER=$(load_or_create_secret "${API_KEY_PEPPER:-}" "$CONFIG_DIR/api-key-pepper")
RATE_LIMIT_PEPPER=$(load_or_create_secret "${RATE_LIMIT_PEPPER:-}" "$CONFIG_DIR/rate-limit-pepper")
AUTH_OTP_PEPPER=$(load_or_create_secret "${AUTH_OTP_PEPPER:-}" "$CONFIG_DIR/auth-otp-pepper")
export AUTH_SECRET API_KEY_PEPPER RATE_LIMIT_PEPPER AUTH_OTP_PEPPER

case "${DATABASE_URL:-}" in
    postgres://*|postgresql://*) ;;
    *) echo "[ERROR] DATABASE_URL must be a PostgreSQL connection URL" >&2; exit 1 ;;
esac

echo "========================================"
echo "  Cashier Application Startup"
echo "========================================"
echo "Environment: ${NODE_ENV:-production}"
echo "Database: configured"
echo "Storage: S3-compatible (${S3_ENDPOINT:-missing})"
echo "Email OTP: $([ -n "${AUTH_RESEND_KEY:-}" ] && echo enabled || echo disabled)"
echo "========================================"

attempt=1
until node scripts/migrate-database.mjs; do
    if [ "$attempt" -ge 30 ]; then
        echo "[ERROR] Database migration did not succeed after $attempt attempts" >&2
        exit 1
    fi
    echo "[INIT] Database unavailable; retrying migration ($attempt/30)..."
    attempt=$((attempt + 1))
    sleep 2
done

echo "[INIT] Starting application..."
exec node server.js
