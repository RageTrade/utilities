import Ftx from './ftx'
import RageTrade from './rage-trade'
import { formatUsdc } from '@ragetrade/sdk'
import { formatEther } from 'ethers/lib/utils'
import { isMovementWithinSpread, calculateFinalPrice } from './helpers'
import { log } from '../discord-logger'
import { OrderSide } from 'ftx-api'

const ftx = new Ftx()
const rageTrade = new RageTrade()

const main = async () => {
  await ftx.initialize()
  await rageTrade.initialize()

  const ftxFee = ftx.takerFee
  const rageFee = rageTrade.ammConfig.FEE

  let pFtx = await ftx.queryFtxPrice()
  let pRage = await rageTrade.queryRagePrice()

  const calculateSizeOfArbitrage = async (
    pRage: number,
    pFtx: number,
    pFinal: number
  ) => {
    console.log('pFtx', pFtx)
    console.log('pRage', pRage)
    console.log('pFinal', pFinal)
    const { vQuoteIn, vTokenIn } = await rageTrade.getLiquidityInRange(pRage, pFinal)

    let liquidity = 0
    let symbol: 'ETH' | 'USDC' = 'ETH'

    // buying (long) ETH on rage
    if (pRage < pFtx) {
      symbol = 'ETH'
      liquidity = Number(formatEther(vTokenIn.abs()))
    }

    // selling (short) ETH on rage
    if (pRage > pFtx) {
      symbol = 'USDC'
      liquidity = Number(formatUsdc(vQuoteIn.abs()))
    }

    return {
      symbol,
      liquidity
    }
  }

  const calculateArbProfit = async (
    pFtx: number,
    arbAsset: 'ETH' | 'USDC',
    potentialArbSize: number,
  ) => {
    let usdProfit = 0;

    if (arbAsset === 'ETH') {
      const { vQuoteIn } = await rageTrade.simulateSwap(potentialArbSize, false)
      const ethPriceReceived = Number(formatUsdc(vQuoteIn.abs())) / potentialArbSize

      console.log('vQuoteIn', formatUsdc(vQuoteIn.abs()))
      console.log('ethPriceReceived', ethPriceReceived)

      usdProfit = potentialArbSize * (ethPriceReceived - pFtx * (1 + ftxFee))

      console.log('usdProfit', usdProfit)
    }

    if (arbAsset === 'USDC') {
      const { vTokenIn } = await rageTrade.simulateSwap(potentialArbSize, true)
      const ethPriceReceived = potentialArbSize / Number(formatEther(vTokenIn.abs()))

      console.log('vTokenIn', formatUsdc(vTokenIn.abs()))
      console.log('ethPriceReceived', ethPriceReceived)

      usdProfit = potentialArbSize * (pFtx * (1 - ftxFee) - ethPriceReceived)

      console.log('usdProfit', usdProfit)
    }

    const tradeCost = await rageTrade.calculateTradeCost()

    return usdProfit - tradeCost
  }

  const arbitrage = async () => {
    const pFinal = calculateFinalPrice(pRage, pFtx, rageFee, ftxFee)

    if (isMovementWithinSpread(pRage, pFtx, pFinal) == true) {
      await log('price movement is within spread', 'ARB_BOT')
      return
    }

    const {
      symbol: arbAsset,
      liquidity: potentialArbSize
    } = await calculateSizeOfArbitrage(pRage, pFtx, pFinal)

    const ftxMargin = await ftx.queryFtxMargin()
    const updatedArbSize = await rageTrade.calculateMaxTradeSize(ftxMargin, pFtx, potentialArbSize, arbAsset)

    console.log('pFtx', pFtx)
    console.log('pRage', pRage)
    console.log('pFinal', pFinal)
    console.log('arbAsset', arbAsset)
    console.log('ftxMargin', ftxMargin)
    console.log('updatedArbSize', updatedArbSize)

    const potentialArbProfit = await calculateArbProfit(pFtx, arbAsset, updatedArbSize)

    console.log('potentialArbProfit', potentialArbProfit)
    console.log(rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT)

    if (potentialArbProfit > rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT) {
      const ftxSide: OrderSide = arbAsset === 'ETH' ? 'sell' : 'buy'
      const rageSide: OrderSide = arbAsset === 'ETH' ? 'buy' : 'sell'

      await ftx.updatePosition(updatedArbSize, ftxSide)
      await rageTrade.updatePosition(updatedArbSize, rageSide)

      console.log('arb successfull')
    }
  }

  arbitrage()
}

main()