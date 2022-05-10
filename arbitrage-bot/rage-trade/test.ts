import { formatUsdc, parseUsdc } from '@ragetrade/sdk'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { calculateFinalPrice, isMovementWithinSpread } from '../helpers'
import RageTrade from './index'

async function main() {
  const rageTrade = new RageTrade()
  await rageTrade.initialize()

  // console.log(rageTrade.currentFundingRate)

  // console.log("getRageNotionalPosition", await rageTrade.getRageNotionalPosition())
  // console.log("queryRagePrice", await rageTrade.queryRagePrice())
  // console.log("getRageNotionalPositionCap", await rageTrade.getRageNotionalPositionCap(0))
  // console.log("currentMarginFraction", await rageTrade.currentMarginFraction())
  // console.log("getRagePositionCap", await rageTrade.getRagePositionCap())
  // console.log("updatePosition", await rageTrade.updatePosition(2, 'buy'))

  // const { vQuoteIn, vTokenIn } = await rageTrade.getLiquidityInRange(2800, 2600)
  // console.log(formatEther(vTokenIn))
  // console.log(formatUsdc(vQuoteIn))

  const pFinal = calculateFinalPrice(2308, 2117.69, 0.000665, 0.005)
  console.log('pFinal', pFinal)
  console.log(isMovementWithinSpread(2308, 2117.69, pFinal))
}

main()
  .then(() => console.log('completed'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
