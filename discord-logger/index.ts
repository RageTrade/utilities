import fetch from 'cross-fetch'
import { NETWORK_INF0 } from '../config-env'

const logger: Record<string, string> = {
  ARB_BOT: NETWORK_INF0.ARB_BOT_WEBHOOK_URL,
  REBALANCE: NETWORK_INF0.REBALANCE_WEBHOOK_URL,
  LIQUIDATION: NETWORK_INF0.LIQUIDATION_WEBHOOK_URL,
  GLP_BATCHING_MANAGER: NETWORK_INF0.GLP_BATCHING_MANAGER_WEBHOOK_URL,
  USDC_BATCHING_MANAGER: NETWORK_INF0.USDC_BATCHING_MANAGER_WEBHOOK_URL,
  DN_GMX_JIT: NETWORK_INF0.DN_GMX_JIT_WEBHOOK_URL,
  HEDGE_STRATEGY: NETWORK_INF0.HEDGE_STRATEGY_WEBHOOK_URL,
}

export const log = async (message: string, channel: string) => {
  await fetch(logger[channel], {
    method: 'post',
    body: JSON.stringify({ content: message }),
    headers: { 'Content-Type': 'application/json' },
  })
}
