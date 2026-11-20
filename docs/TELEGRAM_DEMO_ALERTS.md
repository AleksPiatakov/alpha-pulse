# Alpha Pulse — Telegram Demo alerts

## Purpose

Opt-in notifications when a **fresh, independently verified Bybit Demo
Limit plan** becomes eligible for manual review. Telegram does not place or
cancel any Bybit order. Real account access is not enabled.

The notification includes symbol and direction, Entry/SL/TP, score,
readiness, risk/reward, risk in USDT and as a percentage of Demo equity,
plus verification time. The local analysis link works on the same Mac
where Alpha Pulse is running; it cannot be opened remotely from a phone.

## Setup on the Mac

1. Add your existing Telegram bot as an administrator of your existing
   channel with permission to **post and delete its messages**; editing
   its own messages must also be permitted.
2. Configure only in untracked `.env.local`:
   `TELEGRAM_BOT_TOKEN=<your BotFather token>`
   `TELEGRAM_CHAT_ID=<existing channel numeric id or @public_channel_username>`
   `TELEGRAM_ALERTS_ENABLED=true`
3. Keep `BYBIT_ENV=demo`. Do not commit credentials or post a bot token in chat.
4. Restart `npm run dev` and the separate `npm run scan:worker` process.
5. Worker logs show `Telegram alerts: sent N, errors N` when notifications
   are configured and delivery results occur.

The bot and channel name discussed previously are NOT enough to establish
the numeric chat ID or actual posting permission. Verify configuration
without sending orders. Notifications are disabled by default.

## Strict rule and cleanup

- An alert requires fresh market data, 8/8, score >=90, a passed quality
  gate, a distance <=0.75 ATR, the strict 24-hour shortlist, a second
  independent symbol recheck, Demo account risk/margin sizing, and
  exchange tick/quantity rules. It is a **manual review signal**, not an
  order guarantee. Actual order placement performs its own checks.
- A successful ready notification stores the returned Telegram
  `message_id` and `chat_id` in the local file
  `.alpha-pulse-history/telegram-alert-state.json`.
- The same symbol does not generate new messages on every worker poll.
  If it remains absent from verified READY signals for **at least 10
  minutes and 3 consecutive completed polls**, the worker first calls
  Telegram `deleteMessage` to remove the previous message. If Telegram
  does not allow deletion, it tries `editMessageText` to mark that
  message **НЕАКТУАЛЬНИЙ СИГНАЛ**. Failures are logged and retried.
- Brief missing batches and temporary Bybit/account errors must not
  instantly delete existing messages.
- Old Telegram messages whose IDs were never recorded by the bot
  **cannot safely be identified or bulk-deleted retroactively**.
  Clean those legacy messages manually. The new cleanup applies
  to future messages sent through this updated notifier.
- Telegram message deletion has platform limits, including a general
  48-hour restriction. If deletion and editing both fail, the old post
  may remain visible; check bot admin permissions.
- The persisted local state and signal-history file remain on the Mac
  through application restarts; removing those state files would erase
  the bot's ability to clean earlier posts.

## Validation

Run `node --experimental-strip-types --test
test/telegram-alert-rules.test.mjs test/telegram-message-lifecycle.test.mjs`,
then `npx tsc --noEmit` and `npm run build`. A real Telegram delivery
test requires your configured bot and target chat; no such delivery is
claimed by this change.
