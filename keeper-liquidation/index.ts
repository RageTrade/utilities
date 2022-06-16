import cron from 'node-cron'

import { ethers } from 'ethers'
import { getContracts } from '@ragetrade/sdk'

import { log } from '../discord-logger'
import { NETWORK_INF0, AMM_CONFIG } from '../config'

import {
  ClearingHouse,
  ClearingHouseLens,
} from '@ragetrade/sdk/dist/typechain/core'

let clearingHouse: ClearingHouse
let clearingHouseLens: ClearingHouseLens

const canLiquidate = async (accountId: number) => {
  const {
    marketValue,
    requiredMargin,
  } = await clearingHouse.getAccountMarketValueAndRequiredMargin(
    accountId,
    false
  )

  console.log(requiredMargin.gt(marketValue), accountId)
  return requiredMargin.gt(marketValue)
}

const hasTraderPosition = async (accountId: number) => {
  const {
    netTraderPosition,
  } = await clearingHouseLens.getAccountTokenPositionInfo(
    accountId,
    AMM_CONFIG.POOL_ID
  )
  return netTraderPosition && netTraderPosition.gt(0)
}

const hasLiquiditiyPosition = async (accountId: number) => {
  const liqPositions = await clearingHouseLens.getAccountLiquidityPositionList(
    accountId,
    AMM_CONFIG.POOL_ID
  )
  return liqPositions && liqPositions.length > 0
}

const liquidateTraderPosition = async (accountId: number) => {
  if (await canLiquidate(accountId)) {
    const tx = await clearingHouse.liquidateTokenPosition(
      accountId,
      AMM_CONFIG.POOL_ID
    )
    await tx.wait()

    return tx.hash
  }
}

const liquidateLiquidityPosition = async (accountId: number) => {
  if (await canLiquidate(accountId)) {
    const tx = await clearingHouse.liquidateLiquidityPositions(accountId)
    await tx.wait()

    return tx.hash
  }
}

const liquidate = async () => {
  const lastAccount = (await clearingHouse.numAccounts()).sub(1).toNumber()

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

;(async () => {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    NETWORK_INF0.HTTP_RPC_URL,
    NETWORK_INF0.CHAIN_ID
  )

  const signer = new ethers.Wallet(NETWORK_INF0.PK_LIQUIDATTION, provider)

  ;({ clearingHouse, clearingHouseLens } = await getContracts(signer))

  cron.schedule('*/3 * * * *', () => {
    liquidate()
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
