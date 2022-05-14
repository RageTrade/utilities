import cron from 'node-cron'

import { ethers } from 'ethers'
import { CurveYieldStrategy, getVaultContracts } from '@ragetrade/sdk'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config'

let isReset: boolean
let vault: CurveYieldStrategy

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)
const signer = new ethers.Wallet(NETWORK_INF0.PRIVATE_KEY, provider)

getVaultContracts(signer).then(
  (contracts) => (vault = contracts.curveYieldStrategy)
)

const rebalance = async () => {
  console.log('REBALANCE RUN STARTED!')

  const isValidRebalance = await vault.isValidRebalance(
    await vault.getVaultMarketValue()
  )

  if (isValidRebalance) {
    const tx = await vault.rebalance()
    await tx.wait()

    await log(
      `rebalanced! ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
      'REBALANCE'
    )
  } else {
    await log(
      'not a valid rebalance condition, skipping rebalance...',
      'REBALANCE'
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
    `token position closed! ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
    'REBALANCE'
  )

  isReset = await vault.isReset()
  await log(`updated reset value is ${isReset} `, 'REBALANCE')
}

cron.schedule('*/30 * * * * *', () => {
  if (isReset) return

  rebalance()
    .then(() => console.log('REBALANCE RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})

cron.schedule('*/1 * * * *', () => {
  if (!isReset) return

  closeTokenPosition()
    .then(() => console.log('CLOSE TOKEN POSITION RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})
