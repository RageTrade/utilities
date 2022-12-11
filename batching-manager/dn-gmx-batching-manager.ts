import cron from 'node-cron'

import { BigNumber, ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

import { parseEther } from 'ethers/lib/utils'
import {
  deltaNeutralGmxJIT,
  deltaNeutralGmxVaults,
  DnGmxBatchingManager,
  DnGmxRouter,
} from '@ragetrade/sdk'

let dnGmxRouter: DnGmxRouter
let dnGmxBatchingManager: DnGmxBatchingManager

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(NETWORK_INF0.PK_DN_BATCHING_MANAGER, provider)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const GLP_CONVERSION_THRESHOLD = parseEther('59000')

const executeBatch = async (router: DnGmxRouter, bm: DnGmxBatchingManager) => {
  try {
    const tx1 = await router.executeBatchStake()
    await tx1.wait()

    console.log('stake success')
    log(
      `usdc converted to staked glp, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    console.log('from stake', e)
    log(
      `failed usdc to sglp conversion, ${e.body}, ${e.message}`,
      'BATCHING_MANAGER'
    )
  }

  await sleep(1 * 60 * 1000)

  let conversionAmount
  const glpAmount = await bm.roundGlpDepositPending()

  glpAmount.gt(GLP_CONVERSION_THRESHOLD)
    ? (conversionAmount = GLP_CONVERSION_THRESHOLD)
    : (conversionAmount = glpAmount)

  while (conversionAmount.gt(0)) {
    await sleep(1 * 60 * 1000)

    try {
      const tx1 = await router.executeBatchDeposit(conversionAmount)
      await tx1.wait()

      console.log('batch success')
      log(
        `staked glp batch executed and converted to shares, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx1.hash}`,
        'BATCHING_MANAGER'
      )
    } catch (e: any) {
      console.log('from batch', e)
      log(`error in execute batch, ${e.body}, ${e.message}`, 'BATCHING_MANAGER')
    }

    const glpAmount = await bm.roundGlpDepositPending()

    glpAmount.gt(GLP_CONVERSION_THRESHOLD)
      ? (conversionAmount = GLP_CONVERSION_THRESHOLD)
      : (conversionAmount = glpAmount)
  }
}

;(async () => {
  ;({ dnGmxRouter } = await deltaNeutralGmxJIT.getContracts(signer))
  ;({ dnGmxBatchingManager } = await deltaNeutralGmxVaults.getContracts(signer))
  cron.schedule('0 */1 * * *', () => {
    executeBatch(dnGmxRouter, dnGmxBatchingManager)
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
