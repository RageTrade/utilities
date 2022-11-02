import cron from 'node-cron'

import { ethers } from 'ethers'
import { deltaNeutralGmxVaults, DnGmxJuniorVault } from '@ragetrade/sdk'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

let dnGmxJuniorVault: DnGmxJuniorVault

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)
const signer = new ethers.Wallet(NETWORK_INF0.PK_DN_VAULT_REBALANCE, provider)

const rebalance = async (vault: DnGmxJuniorVault) => {
  console.log('REBALANCE RUN STARTED!')

  try {
    const tx = await vault.rebalance()
    await tx.wait()

    log(
      `rebalanced, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
      'REBALANCE'
    )
  } catch (e: any) {
    log(`failed rebalance, ${e.body}, ${e.message}`, 'REBALANCE')
  }
}

;(async () => {
  ;({ dnGmxJuniorVault } = await deltaNeutralGmxVaults.getContracts(signer))
  cron.schedule('0 */1 * * *', () => {
    rebalance(dnGmxJuniorVault)
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
