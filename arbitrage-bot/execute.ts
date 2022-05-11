import Ftx from './ftx'
import cron from 'node-cron'
import { OrderSide } from 'ftx-api'
import RageTrade from './rage-trade'
import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config'
import { formatUsdc } from '@ragetrade/sdk'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { isMovementWithinSpread, calculateFinalPrice } from './helpers'

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
    const { vQuoteIn, vTokenIn } = await rageTrade.getLiquidityInRange(
      pRage,
      pFinal
    )

    let ethTraded = - Number(formatEther(vTokenIn))  // opposite sign of entering pool

    return {
      ethTraded
    }
  }

  const calculateArbProfit = async (
    pFtx: number,
    potentialArbSize: number
  ) => {
    const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(
        potentialArbSize,
        false
    )

    const ethPriceReceived = Number(formatUsdc(vQuoteIn.abs())) / Math.abs(potentialArbSize)
    let usdProfit = - potentialArbSize * (ethPriceReceived - pFtx * (1 - ftxFee * Math.sign(potentialArbSize)))

    console.log('vTokenIn', formatEther(vTokenIn))
    console.log('vQuoteIn', formatUsdc(vQuoteIn))
    console.log('ethPriceReceived', ethPriceReceived)
    console.log('potentialArbSize (from calc arb profit)', potentialArbSize)
    console.log('usdProfit', usdProfit)

    const tradeCost = await rageTrade.calculateTradeCost()

    return usdProfit - tradeCost
  }

  const arbitrage = async () => {
    pFtx = await ftx.queryFtxPrice()
    pRage = await rageTrade.queryRagePrice()

    const pFinal = calculateFinalPrice(pFtx, pRage, rageFee, ftxFee)

    if (isMovementWithinSpread(pFtx, pRage, pFinal) == true) {
      await log('price movement is within spread', 'ARB_BOT')
      return
    }

    const {ethTraded: potentialArbSize} = await calculateSizeOfArbitrage(pRage, pFtx, pFinal)

    const ftxMargin = await ftx.queryFtxMargin()
    const updatedArbSize = await rageTrade.calculateMaxTradeSize(
      ftxMargin,
      pFtx,
      potentialArbSize
    )

    console.log('pFtx', pFtx)
    console.log('pRage', pRage)
    console.log('pFinal', pFinal)
    console.log('ftxMargin', ftxMargin)
    console.log('potentialArbSize', potentialArbSize)
    console.log('updatedArbSize', updatedArbSize)

    const potentialArbProfit = await calculateArbProfit(
      pFtx,
      Number(updatedArbSize.toFixed(6))
    )

    if (potentialArbProfit > rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT) {
      const ftxSide: OrderSide = updatedArbSize >= 0 ? 'sell' : 'buy'
      const rageSide: OrderSide = updatedArbSize >= 0 ? 'buy' : 'sell'

      const x = await ftx.updatePosition(Math.abs(updatedArbSize), ftxSide)
      const y = await rageTrade.updatePosition(Math.abs(updatedArbSize), rageSide)

      await log(
        `arb successful, ${x.result}, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${y.hash}`,
        'ARB_BOT'
      )
    }
  }

  cron.schedule('*/20 * * * * *', () => {
    arbitrage()
      .then(() => console.log('ARB COMPLETE!'))
      .catch((error) => {
        console.log(error)
      })
  })
}

main()
  .then(() => console.log('ARB STARTED!'))
  .catch((error) => {
    console.log(error)
  })
