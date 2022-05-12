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

/** arbitrage entrypoint */
const main = async () => {
  await ftx.initialize()
  await rageTrade.initialize()

  const ftxFee = ftx.takerFee
  const rageFee = rageTrade.ammConfig.FEE

  let pFtx = await ftx.queryFtxPrice()
  let pRage = await rageTrade.queryRagePrice()

  /** calculates the size of the potential arbitrage in ETH */
  const calculateSizeOfArbitrage = async (
    pRage: number,
    pFtx: number,
    pFinal: number
  ) => {
    const { vQuoteIn, vTokenIn } = await rageTrade.getLiquidityInRange(
      pRage,
      pFinal
    )

    let maxEthPosition = - Number(formatEther(vTokenIn))  // max directional eth position to close price difference

    return {
      maxEthPosition
    }
  }

  /** calculates amount of tokens arb will make before gas cost */
  const calculateArbRevenue = async(
      pFtx: number,
      potentialArbSize: number,
      ethPriceReceived: number,
  ) => {
    return - potentialArbSize * (ethPriceReceived - pFtx * (1 - ftxFee * Math.sign(potentialArbSize)))
  }

  /** calculates arb trade USD profit */
  const calculateArbProfit = async (
    pFtx: number,
    potentialArbSize: number
  ) => {
    const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(
        potentialArbSize,
        false
    )

    const ethPriceReceived = Number(formatUsdc(vQuoteIn.abs())) / Math.abs(potentialArbSize)
    let usdRevenue = calculateArbRevenue(pFtx, potentialArbSize, ethPriceReceived)
    const tradeCost = await rageTrade.calculateTradeCost()

    console.log('vTokenIn', formatEther(vTokenIn))
    console.log('vQuoteIn', formatUsdc(vQuoteIn))
    console.log('ethPriceReceived', ethPriceReceived)
    console.log('potentialArbSize (from calc arb profit)', potentialArbSize)
    console.log('usdRevenue', usdRevenue)
    console.log('tradeCost', tradeCost)

    return usdRevenue - tradeCost
  }

  /** checks for arb and if found, executes the arb */
  const arbitrage = async () => {
    pFtx = await ftx.queryFtxPrice()
    pRage = await rageTrade.queryRagePrice()

    const pFinal = calculateFinalPrice(pFtx, pRage, rageFee, ftxFee)

    if (isMovementWithinSpread(pFtx, pRage, pFinal) == true) {
      await log('price movement is within spread', 'ARB_BOT')
      return
    }

    const {maxEthPosition: potentialArbSize} = await calculateSizeOfArbitrage(pRage, pFtx, pFinal)

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
        console.log(error.message)
      })
  })
}

main()
  .then(() => console.log('ARB STARTED!'))
  .catch((error) => {
    console.log(error.message)
  })
