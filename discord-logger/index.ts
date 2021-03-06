import fetch from 'cross-fetch'
import { NETWORK_INF0 } from '../config-env'

const logger: Record<string, string> = {
  ARB_BOT: NETWORK_INF0.ARB_BOT_WEBHOOK_URL,
  REBALANCE: NETWORK_INF0.REBALANCE_WEBHOOK_URL,
  LIQUIDATION: NETWORK_INF0.LIQUIDATION_WEBHOOK_URL,
}

export const log = async (message: string, channel: string) => {
  await fetch(logger[channel], {
    method: 'post',
    body: JSON.stringify({ content: message }),
    headers: { 'Content-Type': 'application/json' },
  })
}
