import cron from 'node-cron'

import { ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

import { formatUnits, parseUnits } from 'ethers/lib/utils'
import { deltaNeutralGmxVaults, DnGmxBatchingManagerGlp } from '@ragetrade/sdk'

let glpBatchingManager: DnGmxBatchingManagerGlp

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(
  NETWORK_INF0.PK_GLP_BATCHING_MANAGER,
  provider
)

const GLP_CONVERSION_THRESHOLD = parseUnits('50000', 18)

const BATCH_WAIT_INTERVAL = '*/15 * * * *' // in cron format
const CHUNK_WAIT_INTERVAL = 60 * 1000 // in ms

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const executeBatch = async (batchingManager: DnGmxBatchingManagerGlp) => {
  let bal = await batchingManager.roundAssetBalance()

  if (bal.eq(0)) {
    log('no glp to execute batch, skipping...', 'GLP_BATCHING_MANAGER')
    return
  }

  while (bal.gt(0)) {
    try {
      const tx = await batchingManager.executeBatch(GLP_CONVERSION_THRESHOLD, {
        gasPrice: parseUnits("0.1", 9)
      })
      await tx.wait()

      log(
        `${formatUnits(GLP_CONVERSION_THRESHOLD, 18)} glp converted, ${
          NETWORK_INF0.BLOCK_EXPLORER_URL
        }tx/${tx.hash}`,
        'GLP_BATCHING_MANAGER'
      )
    } catch (e: any) {
      console.log('from execute batch', e)
      log(`failed usdc conversion, ${e.body}, ${e.message}`, 'GLP_BATCHING_MANAGER')
    }

    bal = await batchingManager.roundAssetBalance()

    await sleep(CHUNK_WAIT_INTERVAL)
  }
}

;(async () => {
  ;({ dnGmxBatchingManagerGlp: glpBatchingManager } =
    await deltaNeutralGmxVaults.getContracts(signer))

  cron.schedule(BATCH_WAIT_INTERVAL, () => {
    executeBatch(glpBatchingManager)
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        log(error, 'GLP_BATCHING_MANAGER')
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
