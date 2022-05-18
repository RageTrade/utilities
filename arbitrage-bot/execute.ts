import Ftx from './ftx'
import cron from 'node-cron'
import { OrderSide } from 'ftx-api'
import RageTrade from './rage-trade'
import { log } from '../discord-logger'
import {
  AMM_CONFIG,
  FTX_CONFIG,
  NETWORK_INF0,
  STRATERGY_CONFIG,
} from '../config'
import { formatUsdc } from '@ragetrade/sdk'
import { formatEther, parseEther } from 'ethers/lib/utils'
import {
  isMovementWithinSpread,
  calculateFinalPrice,
  calculateArbRevenue,
} from './helpers'

// fix partial
// pre-flight checks
// open github issues (possible optimizations)

const ftx = new Ftx({
  isPriceArb: true,
  rageAccountId: AMM_CONFIG.PRICE_ARB_ACCOUNT_ID,
})

const rageTrade = new RageTrade({
  isPriceArb: true,
  rageAccountId: AMM_CONFIG.PRICE_ARB_ACCOUNT_ID,
})

/** arbitrage entrypoint */
const main = async () => {
  let cronMutex = false

  await ftx.initialize()
  await rageTrade.initialize()

  const ftxFee = FTX_CONFIG.FEE
  const rageFee = AMM_CONFIG.FEE

  let pFtx = await ftx.queryFtxPrice()
  let pRage = await rageTrade.queryRagePrice()

  /** calculates the size of the potential arbitrage in ETH */
  const calculateSizeOfArbitrage = async (
    pRage: number,
    pFtx: number,
    pFinal: number
  ) => {
    const { vTokenIn } = await rageTrade.getLiquidityInRange(pRage, pFinal)

    let maxEthPosition = -Number(formatEther(vTokenIn)) // max directional eth position to close price difference

    return {
      maxEthPosition,
    }
  }

  /** calculates arb trade USD profit */
  const calculateArbProfit = async (pFtx: number, potentialArbSize: number) => {
    const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(
      potentialArbSize,
      false
    )

    const ethPriceReceived =
      Number(formatUsdc(vQuoteIn.abs())) / Math.abs(potentialArbSize)
    let usdRevenue = calculateArbRevenue(
      pFtx,
      potentialArbSize,
      ethPriceReceived,
      ftxFee
    )
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
      await log(
        `price movement is within spread, pFtx: ${pFtx}, pRage: ${pRage}, pFinal: ${pFinal}`,
        'ARB_BOT'
      )
      return
    }

    const { maxEthPosition: potentialArbSize } = await calculateSizeOfArbitrage(
      pRage,
      pFtx,
      pFinal
    )

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
    console.log('potentialArbSize', potentialArbSize)

    const potentialArbProfit = await calculateArbProfit(
      pFtx,
      Number(updatedArbSize.toFixed(6))
    )

    console.log('potentialArbProfit', potentialArbProfit)

    if (potentialArbProfit > STRATERGY_CONFIG.MIN_NOTIONAL_PROFIT) {
      let isSuccessful = false
      const positionPostTrade = await ftx.updatePosition(updatedArbSize)

      try {
        await rageTrade.updatePosition(updatedArbSize, pFinal)
        isSuccessful = true
      } catch (e) {
        isSuccessful = false
        await log(`error: reversing position on ftx`, 'ARB_BOT')
        await ftx.updatePosition(-updatedArbSize)
      }

      const [ragePrice, ragePosition] = await Promise.all([
        rageTrade.queryRagePrice(),
        (await rageTrade.getRagePosition()).eth,
      ])

      console.log('isSuccessful', isSuccessful)

      isSuccessful
        ? await log(
            `arb successful,
        ftxNetSize: ${positionPostTrade.result[0].netSize},
        rageNetSize: ${ragePosition},
        ftxPrice: ${positionPostTrade.result[0].entryPrice},
        ragePrice: ${ragePrice},
        pFinal (expected): ${pFinal},
        pFinal - pRage: ${pFinal - ragePrice},
        pFtx - pRage: ${positionPostTrade.result[0].entryPrice! - ragePrice}`,

            'ARB_BOT'
          )
        : null
    } else {
      await log(
        `profit does not cross minimum threshold to arb, 
                pFtx: ${pFtx}, pRage: ${pRage}, pFinal: ${pFinal},
                potentialArbProfit: ${potentialArbProfit},
                potentialArbSize: ${updatedArbSize}
                `,
        'ARB_BOT'
      )
    }
  }

  cron.schedule(`*/${STRATERGY_CONFIG.FREQUENCY} * * * * *`, () => {
    console.log('cronMutex', cronMutex)
    if (cronMutex) {
      log('SKIPPING ITERATION, BOT IS ALREADY ARBING', 'ARB_BOT')
      return
    }
    cronMutex = true
    arbitrage()
      .then(() => {
        cronMutex = false
        console.log('ARB COMPLETE!')
      })
      .catch((error) => {
        cronMutex = false
        console.log(error.message)
      })
  })
}

main()
  .then(() =>
    log(
      `ARB BOT STARTED WITH FREQUENCY OF ${STRATERGY_CONFIG.FREQUENCY} seconds`,
      'ARB_BOT'
    )
  )
  .catch((error) => {
    console.log(error.message)
  })
