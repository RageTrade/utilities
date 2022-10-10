import cron from 'node-cron'

import { ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

import {
  getGmxVaultContracts,
  GlpStakingManager,
  GMXBatchingManager,
} from '@ragetrade/sdk'

let glpStakingManager: GlpStakingManager
let gmxBatchingManager: GMXBatchingManager

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(NETWORK_INF0.PK_BATCHING_MANAGER, provider)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const executeBatch = async (bm: GMXBatchingManager, sm: GlpStakingManager) => {
  try {
    const tx1 = await sm.harvestFees()
    await tx1.wait()

    log(
      `fees harvested, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    log(`failed fees harvesting, ${e.body}, ${e.message}`, 'BATCHING_MANAGER')
  }

  try {
    const tx1 = await bm.pauseDeposit()
    await tx1.wait()
    await sleep(15 * 60 * 1000 + 30 * 1000)
    log(
      `pause + 15 min wait success, batch will execute now, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    log(`failed pausing, ${e.body}, ${e.message}`, 'BATCHING_MANAGER')
  }

  try {
    const tx1 = await bm.unpauseDeposit()
    await tx1.wait()

    log(
      `deposits unpaused, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    log(`failed unpausing, ${e.body}, ${e.message}`, 'BATCHING_MANAGER')
  }

  try {
    const tx1 = await bm.executeBatchDeposit()
    await tx1.wait()
    log(
      `batch exeucuted, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    const match = e.toString().match('cooldown')
    match
      ? log('skipping, cooldown', 'BATCHING_MANAGER')
      : log(`failed execute, ${e.body}, ${e.message}`, 'BATCHING_MANAGER')
  }
}

;(async () => {
  ;({ gmxBatchingManager, glpStakingManager } = await getGmxVaultContracts(
    signer
  ))
  cron.schedule('0 */12 * * *', () => {
    executeBatch(gmxBatchingManager, glpStakingManager)
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
