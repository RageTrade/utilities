import { ethers } from 'ethers'
import { getContracts } from '@ragetrade/sdk'

import { log } from '../discord-logger'
import { NETWORK_INF0, AMM_CONFIG } from '../config'

import cron from 'node-cron'

const main = async () => {
  console.log('RUN STARTED!')

  const provider = new ethers.providers.AlchemyWebSocketProvider(
    NETWORK_INF0.CHAIN_ID,
    NETWORK_INF0.ALCHEMY_API_KEY
  )

  const signer = new ethers.Wallet(NETWORK_INF0.PK_LIQUIDATTION, provider)

  const clearingHouse = (await getContracts(signer)).clearingHouse
  const lastAccount = (await clearingHouse.numAccounts()).sub(1).toNumber()

  const canLiquidate = async (accountId: number) => {
    const {
      marketValue,
      requiredMargin,
    } = await clearingHouse.getAccountMarketValueAndRequiredMargin(
      accountId,
      false
    )

    console.log(requiredMargin.gt(marketValue), accountId)
    return requiredMargin.gt(marketValue) ? true : false
  }

  const hasTraderPosition = async (accountId: number) => {
    const { tokenPositions } = await clearingHouse.getAccountInfo(accountId)
    if (tokenPositions.length > 0)
      return !tokenPositions[0].netTraderPosition.isZero()
    return false
  }

  const hasLiquiditiyPosition = async (accountId: number) => {
    const { tokenPositions } = await clearingHouse.getAccountInfo(accountId)
    if (tokenPositions.length > 0)
      return tokenPositions[0].liquidityPositions.length > 0 ? true : false
    return false
  }

  const liquidateTraderPosition = async (accountId: number) => {
    if (await canLiquidate(accountId)) {
      const tx = await clearingHouse
        .connect(signer)
        .liquidateTokenPosition(accountId, AMM_CONFIG.POOL_ID)
      await tx.wait()

      return tx.hash
    }
  }

  const liquidateLiquidityPosition = async (accountId: number) => {
    if (await canLiquidate(accountId)) {
      const tx = await clearingHouse
        .connect(signer)
        .liquidateLiquidityPositions(accountId)
      await tx.wait()

      return tx.hash
    }
  }

  for (let id = 0; id <= lastAccount; id++) {
    if (await canLiquidate(id)) {
      await log(`account # ${id} is underwater, liquidating...`, 'LIQUIDATION')
      const hasTradPos = await hasTraderPosition(id)
      const hasLiqPos = await hasLiquiditiyPosition(id)

      if (hasLiqPos) {
        const tx = await liquidateLiquidityPosition(id)
        await log(
          `liquidity position of account # ${id} liquidated!
          ${NETWORK_INF0.BLOCK_EXPLORER_URL}/tx/${tx}`,
          'LIQUIDATION'
        )
      }
      if (hasTradPos) {
        const tx = await liquidateTraderPosition(id)
        await log(
          `trader position of account # ${id} liquidated!,
          ${NETWORK_INF0.BLOCK_EXPLORER_URL}/tx/${tx}`,
          'LIQUIDATION'
        )
      }
    }
  }
}

cron.schedule('*/3 * * * *', () => {
  main()
    .then(() => console.log('RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})
