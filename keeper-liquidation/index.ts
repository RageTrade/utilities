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

  const signer = new ethers.Wallet(NETWORK_INF0.PRIVATE_KEY, provider)

  const clearingHouse = (await getContracts(signer)).clearingHouse
  const lastAccount = (await clearingHouse.callStatic.createAccount())
    .sub(1)
    .toNumber()

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
      return (
        tokenPositions[0].netTraderPosition.gt(0) &&
        !tokenPositions[0].balance.isZero()
      )
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
      await clearingHouse
        .connect(signer)
        .liquidateTokenPosition(accountId, AMM_CONFIG.POOL_ID)
    }
  }

  const liquidateLiquidityPosition = async (accountId: number) => {
    if (await canLiquidate(accountId)) {
      await clearingHouse.connect(signer).liquidateLiquidityPositions(accountId)
    }
  }

  for (let id = 0; id <= lastAccount; id++) {
    if (await canLiquidate(id)) {
      await log(`account # ${id} is underwater, liquidating...`, 'LIQUIDATION')
      const hasTradPos = await hasTraderPosition(id)
      const hasLiqPos = await hasLiquiditiyPosition(id)

      if (hasLiqPos) {
        await liquidateLiquidityPosition(id)
        await log(
          `liquidity position of account # ${id} liquidated!`,
          'LIQUIDATION'
        )
      }
      if (hasTradPos) {
        await liquidateTraderPosition(id)
        await log(
          `trader position of account # ${id} liquidated!`,
          'LIQUIDATION'
        )
      }
    }
  }
}

cron.schedule('*/1 * * * *', () => {
  main()
    .then(() => console.log('RUN COMPLETE!'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
})
