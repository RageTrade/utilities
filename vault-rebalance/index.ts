import cron from 'node-cron'

import { ethers } from 'ethers'
import { CurveYieldStrategy, getTricryptoVaultContracts } from '@ragetrade/sdk'

import { log } from '../discord-logger'
import {
  NETWORK_INF0,
  CRON_REBALANCE,
  BOT_WATCHER_ROLE,
  CRON_CLOSE_TOKEN_POSITION,
} from '../config-env'

let isReset: boolean
let vault: CurveYieldStrategy

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)
const signer = new ethers.Wallet(NETWORK_INF0.PK_VAULT_REBALANCE, provider)

const TOKEN_POSITION_CLOSED =
  '0x9a94a63b02012d6753ed863b962aceb756429b4265fc327391dd05fb24d4502b'

getTricryptoVaultContracts(signer).then(
  (contracts) => (vault = contracts.curveYieldStrategy)
)

const rebalance = async () => {
  console.log('REBALANCE RUN STARTED!')

  const isValidRebalance = await vault.isValidRebalance(
    await vault.getVaultMarketValue()
  )

  if (isValidRebalance) {
    const tx = await vault.rebalance()
    const receipt = await tx.wait()

    await log(
      `rebalanced! ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
      'REBALANCE_80_20'
    )

    for (const each of receipt.logs) {
      if (each.topics[0] == TOKEN_POSITION_CLOSED) {
        await log(
          `${BOT_WATCHER_ROLE} reset happend internally during rebalance`,
          'REBALANCE_80_20'
        )
      }
    }
  } else {
    await log(
      'not a valid rebalance condition, skipping rebalance...',
      'REBALANCE_80_20'
    )
  }

  isReset = await vault.isReset()
  await log(`updated reset value is ${isReset} `, 'REBALANCE')
}

const closeTokenPosition = async () => {
  console.log('CLOSE TOKEN POSITION RUN STARTED!')

  const tx = await vault.closeTokenPosition()
  await tx.wait()

  await log(
    `${BOT_WATCHER_ROLE} token position closed! ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
    'REBALANCE_80_20'
  )

  isReset = await vault.isReset()
  await log(`updated reset value is ${isReset} `, 'REBALANCE_80_20')
}

cron.schedule(CRON_REBALANCE, async () => {
  isReset = await vault.isReset()
  if (isReset) return

  rebalance()
    .then(() => console.log('REBALANCE RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})

cron.schedule(CRON_CLOSE_TOKEN_POSITION, async () => {
  isReset = await vault.isReset()
  if (!isReset) return

  closeTokenPosition()
    .then(() => console.log('CLOSE TOKEN POSITION RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})
