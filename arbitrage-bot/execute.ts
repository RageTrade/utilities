import Ftx from './ftx'
import RageTrade from './rage-trade'
import { isMovementWithinSpread, calculateFinalPrice } from './helpers'

import { Side } from '../types'

const ftx = new Ftx()
const rageTrade = new RageTrade()

const rageFee = rageTrade.ammConfig.FEE
const ftxFee = ftx.ftxConfig.ftxFee

const main = async () => {
  let pFtx = await ftx.queryFtxPrice()
  let pRage = await rageTrade.queryRagePrice()

  const calculateSizeOfArbitrage = async (
    pRage: number,
    pFtx: number,
    pFinal: BigInt,
    tickPrices: BigInt[],
    tickLiquidities: BigInt[]
  ) => {
    if (pRage < pFtx) {
      const size = await rageTrade.getQuoteAssetUsed(
        pRage,
        pFinal,
        tickPrices,
        tickLiquidities
      )
      return {
        potentialArbSize: size,
        arbAsset: 'USDC',
      }
    }

    const size = await rageTrade.getBaseAssetUsed(
      pRage,
      pFinal,
      tickPrices,
      tickLiquidities
    )
    return {
      potentialArbSize: size,
      arbAsset: 'ETH',
    }
  }

  const calculateArbProfit = async (
    potentialArbSize: number,
    pRage: number,
    pFtx: number,
    tickPrices: BigInt[],
    tickLiquidities: BigInt[],
    side: Side
  ) => {
    let usdProfit

    if ((side = Side.SELL)) {
      const { output, price } = await rageTrade.simulateSwap(potentialArbSize)
      const ethPriceRecieved = price / potentialArbSize
      usdProfit = potentialArbSize * (ethPriceRecieved - pFtx * (1 + ftxFee))
    } else {
      const { output, price } = await rageTrade.simulateSwap(potentialArbSize)
      const ethPriceRecieved = potentialArbSize / price
      usdProfit = potentialArbSize * (pFtx * (1 - ftxFee) - ethPriceRecieved)
    }

    const nTicksCrossed = 0 // TODO: after confirming

    const tradeCost = await rageTrade.calculateTradeCost(Number(nTicksCrossed))

    return usdProfit - tradeCost
  }

  const arbitrage = async () => {
    const pFinal = await calculateFinalPrice(pRage, pFtx, rageFee, ftxFee)

    if (isMovementWithinSpread(pRage, pFtx, pFinal) == true) {
      console.log('price movement is within spread')
      return
    }

    const {
      tickPrices,
      tickLiquidities,
    } = await rageTrade.queryRelevantUniV3Liquidity(pRage, pFinal)

    let { potentialArbSize, arbAsset } = await calculateSizeOfArbitrage(
      pRage,
      pFtx,
      BigInt(pFinal),
      tickPrices,
      tickLiquidities
    )

    let side
    arbAsset == 'ETH' ? (side = Side.SELL) : (side = Side.BUY)

    potentialArbSize = BigInt(
      await rageTrade.calculateMaxTradeSize(
        Number(potentialArbSize),
        side,
        pFtx,
        ftxFee
      )
    )

    const potentialArbProfit = await calculateArbProfit(
      Number(potentialArbSize),
      pRage,
      pFtx,
      tickPrices,
      tickLiquidities,
      side
    )

    if (potentialArbProfit > rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT) {
      // executeTrade(potentialArbSize, arbAsset)
    }
  }
}
