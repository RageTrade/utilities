import cron from 'node-cron'

import { ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

import { deltaNeutralGmxVaults } from '@ragetrade/sdk'
import { DnGmxTraderHedgeStrategy } from '@ragetrade/sdk/dist/typechain/delta-neutral-gmx-vaults'

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(
  NETWORK_INF0.PK_USDC_BATCHING_MANAGER,
  provider
)

const UPDATE_HEDGE_WAIT_INTERVAL = '0 */12 * * *';

let dnGmxTraderHedgeStrategy: DnGmxTraderHedgeStrategy;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const updateHedges = async (hedgeStrategy: DnGmxTraderHedgeStrategy) => {
  try {
    const tx = await hedgeStrategy.setTraderOIHedges()
    await tx.wait()
    log(`hedges updated successfully, ${NETWORK_INF0.BLOCK_EXPLORER_URL}/tx/${tx}`, 'HEDGE_STRATEGY')
  } catch (e) {
    log(`updating hedges failed, ${e.body}, ${e.msg}`, 'HEDGE_STRATEGY')
  }
}

;(async () => {
;({ dnGmxTraderHedgeStrategy } =await deltaNeutralGmxVaults.getContracts(signer))

cron.schedule(UPDATE_HEDGE_WAIT_INTERVAL, () => {

  updateHedges(dnGmxTraderHedgeStrategy)
    .then(() => console.log('RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      log(error, 'BATCHING_MANAGER')
      process.exit(1)
    })
  })

})().catch((e) => console.log(e))
