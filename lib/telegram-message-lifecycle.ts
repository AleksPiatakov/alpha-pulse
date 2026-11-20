/**
 * A short scan gap or temporary Bybit outage must not erase a still-valid
 * Telegram alert. Cleanup requires sustained absence and elapsed time.
 */
export const TELEGRAM_RETIRE_GRACE_MS=10*60_000;
export const TELEGRAM_RETIRE_MIN_MISSES=3;
export function shouldRetireTelegramSignal(
  misses:number,lastConfirmedAt:number,now:number
):boolean{
  return Number.isSafeInteger(misses)&&misses>=TELEGRAM_RETIRE_MIN_MISSES&&
    Number.isSafeInteger(lastConfirmedAt)&&lastConfirmedAt>0&&
    Number.isSafeInteger(now)&&now>=lastConfirmedAt&&
    now-lastConfirmedAt>=TELEGRAM_RETIRE_GRACE_MS;
}
