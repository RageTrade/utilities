export const PRE_FLIGHT_CHECK = {
  ARB_ETH_BAL_THRESHOLD: 0.1,
  FTX_BALANCE_THRESHOLD: 500,
  RAGETRADE_BAL_THRESHOLD: 100 * 10 ** 6,
  BLOCK_TIMESTAMP_FRESHNESS_THRESHOLD: 10 * 60,
}

export const NETWORK_INF0 = {
  CHAIN_ID: 421611,
  WSS_RPC_URL: '',
  PRIVATE_KEY: '',
  ALCHEMY_API_KEY: '',
  BLOCK_EXPLORER_API: '',
  BLOCK_EXPLORER_URL: '',
  ARB_BOT_WEBHOOK_URL: '',
  REBALANCE_WEBHOOK_URL: '',
  LIQUIDATION_WEBHOOK_URL: '',
}

export const AMM_CONFIG = {
  POOL_ID: 1,
  FEE: 150,
  ACCOUNT_ID: 0,
  MIN_NOTIONAL_SIZE: 30,
  MIN_REQUIRED_MARGIN: 100 * 10 ** 6,
}

export const FTX_CONFIG = {
  FEE: 150,
  MARKET_ID: '',
  SUB_ACCOUNT_ID: '',
  SCALING_FACTOR: 1000,
}

export const STRATERGY_CONFIG = {
  LOCAL_MAX_LEVERAGE: 2,
  MIN_NOTIONAL_PROFIT: 10,
  MAX_SLIPPAGE_TOLERANCE: 20,
  V_TOKEN_PRICE_FEED_FETCH_INTERVAL: 10 * 60,
}
