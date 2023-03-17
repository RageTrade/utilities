import cron from 'node-cron'

import { ethers } from 'ethers'

import { log } from '../discord-logger'
import { BOT_WATCHER_ROLE, NETWORK_INF0 } from '../config-env'

import { formatUnits, parseUnits } from 'ethers/lib/utils'
import { deltaNeutralGmxVaults, DnGmxBatchingManager } from '@ragetrade/sdk'

let usdcBatchingManager: DnGmxBatchingManager

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(
  NETWORK_INF0.PK_USDC_BATCHING_MANAGER,
  provider
)

const USDC_CONVERSION_THRESHOLD = parseUnits('50000', 6)

const BATCH_WAIT_INTERVAL = '*/15 * * * *' // in cron format
const CHUNK_WAIT_INTERVAL = 60 * 1000 // in ms

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const executeBatch = async (batchingManager: DnGmxBatchingManager) => {
  let bal = await batchingManager.roundUsdcBalance()

  if (bal.eq(0)) {
    log('no usdc to execute batch, skipping...', 'USDC_BATCHING_MANAGER')
    return
  }

  while (bal.gt(0)) {
    try {
      const tx = await batchingManager.executeBatch(USDC_CONVERSION_THRESHOLD, {
        gasPrice: parseUnits("0.1", 9)
      })
      await tx.wait()

      log(
        `${formatUnits(USDC_CONVERSION_THRESHOLD, 6)} usdc converted, ${
          NETWORK_INF0.BLOCK_EXPLORER_URL
        }tx/${tx.hash}`,
        'USDC_BATCHING_MANAGER'
      )
    } catch (e: any) {
      console.log('from execute batch', e)
      log(`${BOT_WATCHER_ROLE} failed usdc conversion, ${e.body}, ${e.message}`, 'USDC_BATCHING_MANAGER')
    }

    bal = await batchingManager.roundUsdcBalance()

    await sleep(CHUNK_WAIT_INTERVAL)
  }
}

;(async () => {
  ;({ dnGmxBatchingManager: usdcBatchingManager } =
    await deltaNeutralGmxVaults.getContracts(signer))

  cron.schedule(BATCH_WAIT_INTERVAL, () => {
    executeBatch(usdcBatchingManager)
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        log(`${BOT_WATCHER_ROLE} ${error}`, 'USDC_BATCHING_MANAGER')
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
