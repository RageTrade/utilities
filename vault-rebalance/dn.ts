import cron from 'node-cron'

import { ethers } from 'ethers'
import { deltaNeutralGmxVaults, DnGmxJuniorVault } from '@ragetrade/sdk'

import { log } from '../discord-logger'
import { BOT_WATCHER_ROLE, NETWORK_INF0 } from '../config-env'
import { parseUnits } from 'ethers/lib/utils'

let dnGmxJuniorVault: DnGmxJuniorVault

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)
const signer = new ethers.Wallet(NETWORK_INF0.PK_DN_VAULT_REBALANCE, provider)

const rebalance = async () => {
  console.log('REBALANCE STARTED!')

  const isValidRebalance = await dnGmxJuniorVault.isValidRebalance()

  if (!isValidRebalance) {
    return
  }

  try {
    const tx = await dnGmxJuniorVault.rebalance({
      gasPrice: parseUnits('0.1', 9),
    })
    await tx.wait()

    log(
      `rebalanced, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
      'REBALANCE_DN'
    )
  } catch (e: any) {
    log(
      `${BOT_WATCHER_ROLE} failed rebalance, ${e.body}, ${e.message}`,
      'REBALANCE_DN'
    )
  }
}

;(async () => {
  ;({ dnGmxJuniorVault } = await deltaNeutralGmxVaults.getContracts(signer))
  cron.schedule('*/1 * * * *', async () => {
    await rebalance()
  })
})().catch((e) => console.log(e))
