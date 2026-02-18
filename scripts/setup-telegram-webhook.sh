#!/bin/bash
#
# Setup Telegram Bot webhook.
# Registers the webhook URL with Telegram Bot API.
#
# Usage:
#   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy APP_URL=https://your-app.com ./scripts/setup-telegram-webhook.sh
#
# Or just run if env vars are already set (e.g. from .env).

set -e

# Load .env if present
if [ -f .env ]; then
  echo "Loading .env..."
  set -a
  source .env
  set +a
fi

# Validate required vars
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN is not set"
  exit 1
fi

if [ -z "$TELEGRAM_WEBHOOK_SECRET" ]; then
  echo "ERROR: TELEGRAM_WEBHOOK_SECRET is not set"
  exit 1
fi

# APP_URL fallback
APP_URL="${APP_URL:-${NEXTAUTH_URL:-}}"
if [ -z "$APP_URL" ]; then
  echo "ERROR: APP_URL (or NEXTAUTH_URL) is not set"
  exit 1
fi

WEBHOOK_URL="${APP_URL}/api/telegram/webhook"

echo "Setting webhook..."
echo "  URL: ${WEBHOOK_URL}"
echo ""

RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"],
    \"drop_pending_updates\": true
  }")

echo "Response:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

# Verify webhook info
echo ""
echo "Verifying webhook..."
INFO=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")
echo "$INFO" | python3 -m json.tool 2>/dev/null || echo "$INFO"
