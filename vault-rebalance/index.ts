import { ethers } from 'ethers'
import { getContracts, getVaultContracts } from '@ragetrade/sdk'

import { log } from '../discord-logger'
import { NETWORK_INF0, AMM_CONFIG } from '../config'

import cron from 'node-cron'

let isReset: boolean

const rebalance = async () => {
  console.log('REBALANCE RUN STARTED!')

  const provider = new ethers.providers.AlchemyWebSocketProvider(
    NETWORK_INF0.CHAIN_ID,
    NETWORK_INF0.ALCHEMY_API_KEY
  )

  const signer = new ethers.Wallet(NETWORK_INF0.PRIVATE_KEY, provider)

  const vault = (await getVaultContracts(signer)).curveYieldStrategy

  const isValidRebalance = await vault.isValidRebalance(
    await vault.getVaultMarketValue()
  )

  if (isValidRebalance) {
    await log('rebalance opportunity found...', 'REBALANCE')
    await vault.rebalance({
      gasLimit: 1_000_000,
    })
    await log('rebalanced!', 'REBALANCE')
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

  const provider = new ethers.providers.AlchemyWebSocketProvider(
    NETWORK_INF0.CHAIN_ID,
    NETWORK_INF0.ALCHEMY_API_KEY
  )

  const signer = new ethers.Wallet(NETWORK_INF0.PRIVATE_KEY, provider)

  const vault = (await getVaultContracts(signer)).curveYieldStrategy

  if (isReset) {
    await log('reset is true, closing token position...', 'REBALANCE')
    await closeTokenPosition()
    await log('token position closed!', 'REBALANCE')
  } else {
    await log('reset is false, skipping...', 'REBALANCE')
  }

  isReset = await vault.isReset()
  await log(`updated reset value is ${isReset} `, 'REBALANCE')
}

cron.schedule('*/2 * * * *', () => {
  rebalance()
    .then(() => console.log('RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})

cron.schedule('*/1 * * * *', () => {
  closeTokenPosition()
    .then(() => console.log('RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})
