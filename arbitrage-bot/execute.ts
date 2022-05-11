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

// to change everything in eth denomination
// quanties should match in eth
// _preFlightChecks every x seconds // review

// _preFlightChecks every x seconds // implement
// rebuild, containerize & deploy

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

    console.log('vQuoteIn * ', vQuoteIn.toBigInt())
    console.log('vTokenIn * ', vTokenIn.toBigInt())

    let ethTraded = - Number(formatEther(vTokenIn))  // opposite sign of entering pool

    return {
      ethTraded
    }
  }

  const calculateArbProfit = async (
    pFtx: number,
    potentialArbSize: number
  ) => {
    let usdProfit = 0

    const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(
        potentialArbSize,
        false
    )

    const ethPriceReceived = Number(formatUsdc(vQuoteIn.abs())) / Math.abs(potentialArbSize)

    console.log('vTokenIn', formatEther(vTokenIn.abs()))
    console.log('vQuoteIn', formatUsdc(vQuoteIn.abs()))
    console.log('ethPriceReceived', ethPriceReceived)
    console.log('potentialArbSize (from calc arb profit)', potentialArbSize)

    if (potentialArbSize >= 0) {  // long rage
      usdProfit = Math.abs(potentialArbSize) * (pFtx * (1 - ftxFee) - ethPriceReceived)
    } else if (potentialArbSize < 0) {  // short rage
      usdProfit = Math.abs(potentialArbSize) * (ethPriceReceived - pFtx * (1 + ftxFee))
    }
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

    const {
      ethTraded: potentialArbSize,
    } = await calculateSizeOfArbitrage(pRage, pFtx, pFinal)

    console.log('initial PotentialArbSize', potentialArbSize)

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
    console.log('updatedArbSize', updatedArbSize)

    const potentialArbProfit = await calculateArbProfit(
      pFtx,
      Number(updatedArbSize.toFixed(6))
    )

    console.log('potentialArbProfit', potentialArbProfit)
    console.log(rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT)

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
