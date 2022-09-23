import cron from 'node-cron'

import { ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

import { getGmxVaultContracts, GMXBatchingManager } from '@ragetrade/sdk'

let gmxBatchingManager: GMXBatchingManager

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(NETWORK_INF0.PK_BATCHING_MANAGER, provider)

const executeBatch = async (bm: GMXBatchingManager) => {
  try {
    const tx = await bm.executeBatchDeposit()
    await tx.wait()
    log(
      `batch exeucuted, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
      'BATCHING_MANAGER'
    )
  } catch (e: any) {
    const match = e.toString().match('cooldown')
    match
      ? log('skipping, cooldown', 'BATCHING_MANAGER')
      : log(`${e.body}, ${e.message}`, 'BATCHING_MANAGER')
  }
}

;(async () => {
  ;({ gmxBatchingManager } = await getGmxVaultContracts(signer))
  cron.schedule('*/20 * * * *', () => {
    executeBatch(gmxBatchingManager)
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
