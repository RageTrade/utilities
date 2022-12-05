import cron from 'node-cron'

import { BigNumber, ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

import { deltaNeutralGmxVaults, DnGmxBatchingManager } from '@ragetrade/sdk'
import { parseEther } from 'ethers/lib/utils'

let dnGmxBatchingManager: DnGmxBatchingManager

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(NETWORK_INF0.PK_DN_BATCHING_MANAGER, provider)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const GLP_CONVERSION_THRESHOLD = parseEther('135000')

const executeBatch = async (bm: DnGmxBatchingManager) => {
  try {
    const tx1 = await bm.executeBatchStake()
    await tx1.wait()

    console.log('stake success')
    log(
      `usdc converted to staked glp, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    console.log('from stake', e)
    log(`failed fees harvesting, ${e.body}, ${e.message}`, 'BATCHING_MANAGER')
  }

  await sleep(20 * 60 * 1000)

  try {
    let conversionAmount
    const glpAmount = await dnGmxBatchingManager.roundGlpDepositPending()

    glpAmount.gt(GLP_CONVERSION_THRESHOLD)
      ? (conversionAmount = GLP_CONVERSION_THRESHOLD)
      : (conversionAmount = glpAmount)

    const tx1 = await bm.executeBatchDeposit(conversionAmount)
    await tx1.wait()

    console.log('batch success')
    log(
      `staked glp batch executed and converted to shares, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    console.log('from batch', e)
    log(`failed pausing, ${e.body}, ${e.message}`, 'BATCHING_MANAGER')
  }
}

;(async () => {
  ;({ dnGmxBatchingManager } = await deltaNeutralGmxVaults.getContracts(signer))
  cron.schedule('0 */2 * * *', () => {
    executeBatch(dnGmxBatchingManager)
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
