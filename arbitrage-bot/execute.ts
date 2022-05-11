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
      liquidity = Number(formatUsdc(vQuoteIn.abs())) // for correctness, this should really be changed to ETH
    }

    return {
      symbol,
      liquidity,
    }
  }

  const calculateArbProfit = async (
    pFtx: number,
    arbAsset: 'ETH' | 'USDC',
    potentialArbSize: number
  ) => {
    let usdProfit = 0

    if (arbAsset === 'ETH') {
      const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(
        potentialArbSize,
        false
      )
      const ethPriceReceived =
        Number(formatUsdc(vQuoteIn.abs())) / potentialArbSize

      console.log('vTokenIn', formatEther(vTokenIn.abs()))
      console.log('vQuoteIn', formatUsdc(vQuoteIn.abs()))
      console.log('ethPriceReceived', ethPriceReceived)

      console.log('potentialArbSize (from calc arb profit)', potentialArbSize)

      usdProfit = potentialArbSize * (pFtx * (1 - ftxFee) - ethPriceReceived)

      console.log('usdProfit', usdProfit)
    }

    if (arbAsset === 'USDC') {
      const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(
        potentialArbSize,
        true
      )
      const ethPriceReceived =
        potentialArbSize / Number(formatEther(vTokenIn.abs()))

      console.log('vTokenIn', formatEther(vTokenIn.abs()))
      console.log('vQuoteIn', formatUsdc(vQuoteIn.abs()))
      console.log('ethPriceReceived', ethPriceReceived)

      console.log('potentialArbSize (from calc arb profit)', potentialArbSize)

      // this is an estimation unless calculated in ETH terms...
      usdProfit =
        potentialArbSize * (ethPriceReceived / (pFtx * (1 + ftxFee)) - 1)

      console.log('usdProfit', usdProfit)
    }

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
      symbol: arbAsset,
      liquidity: potentialArbSize,
    } = await calculateSizeOfArbitrage(pRage, pFtx, pFinal)

    const ftxMargin = await ftx.queryFtxMargin()
    const updatedArbSize = await rageTrade.calculateMaxTradeSize(
      ftxMargin,
      pFtx,
      potentialArbSize,
      arbAsset
    )

    console.log('pFtx', pFtx)
    console.log('pRage', pRage)
    console.log('pFinal', pFinal)
    console.log('arbAsset', arbAsset)
    console.log('ftxMargin', ftxMargin)
    console.log('updatedArbSize', updatedArbSize)

    const potentialArbProfit = await calculateArbProfit(
      pFtx,
      arbAsset,
      Number(updatedArbSize.toFixed(6))
    )

    console.log('potentialArbProfit', potentialArbProfit)
    console.log(rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT)

    if (potentialArbProfit > rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT) {
      const ftxSide: OrderSide = arbAsset === 'ETH' ? 'sell' : 'buy'
      const rageSide: OrderSide = arbAsset === 'ETH' ? 'buy' : 'sell'

      // note that when selling, this logic underestimates arb as pRage isn't avg price, should be done in ETH terms..
      const rageQuantity =
        arbAsset === 'ETH' ? updatedArbSize : updatedArbSize / pRage

      console.log('rageQuantity', rageQuantity)

      const x = await ftx.updatePosition(rageQuantity, ftxSide)
      const y = await rageTrade.updatePosition(rageQuantity, rageSide)

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
