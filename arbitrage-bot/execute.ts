import Ftx from './ftx'
import cron from 'node-cron'
import RageTrade from './rage-trade'
import { log } from '../discord-logger'

import {
  AMM_CONFIG,
  BOT_WATCHER_ROLE,
  FTX_CONFIG,
  RUNS_TO_LOG_AFTER,
  STRATERGY_CONFIG,
} from '../config-env'

import { formatUsdc } from '@ragetrade/sdk'
import { formatEther } from 'ethers/lib/utils'

import {
  isMovementWithinSpread,
  calculateFinalPrice,
  calculateArbRevenue,
} from './helpers'

const ftx = new Ftx({
  isPriceArb: true,
  rageAccountId: AMM_CONFIG.PRICE_ARB_ACCOUNT_ID,
})

const rageTrade = new RageTrade({
  isPriceArb: true,
  rageAccountId: AMM_CONFIG.PRICE_ARB_ACCOUNT_ID,
})

let currentRuns = 0

let totalTrades = 0
let totalRevesedTrades = 0

let lastEthBal = 0
let currentEthBal = 0

let ftxAccountMarketValue = 0
let rageAccountMarketValue = 0
let lastRecordedAccountMarketValueSum = 0

/** arbitrage entrypoint */
const main = async () => {
  let cronMutex = false

  // await ftx.initialize()
  await rageTrade.initialize()

  const ftxFee = FTX_CONFIG.FEE
  const rageFee = AMM_CONFIG.FEE

  let pFtx = await ftx.queryFtxPrice()
  console.log({ pFtx })
  let pRage = await rageTrade.queryRagePrice()
  console.log({ pRage })

  const logState = async () => {
    currentEthBal = (await rageTrade.getEthBalanceAndNonce()).ethBal

    // const [ftxFundingRate /** rageFundingRate */] = await Promise.all([
    //   ftx.getCurrentFundingRate(),
    //   rageTrade.getCurrentFundingRate(),
    // ])

    ftxAccountMarketValue = 10000
    rageAccountMarketValue = await rageTrade.getRageMarketValue()

    // const totalTradesOnFtx = await ftx.getTotalTrades(
    //   Math.floor(Date.now() / 1000) - 15 * 60,
    //   Math.floor(Date.now() / 1000)
    // )

    const data = {
      // ftxFundingRate: ftxFundingRate,
      // rageFundingRate: rageFundingRate,
      // ftxAccountMarketValue: ftxAccountMarketValue,
      rageAccountMarketValue: rageAccountMarketValue,
      previousMarketValueSum: lastRecordedAccountMarketValueSum,
      // currentMarketValueSum: ftxAccountMarketValue + rageAccountMarketValue,
      // changeInSumOfMarketValue:
      //   ftxAccountMarketValue +
      //   rageAccountMarketValue -
      //   lastRecordedAccountMarketValueSum,
      currentEthBalance: currentEthBal,
      previousEthBalance: lastEthBal,
      changeInEthBalance: currentEthBal - lastEthBal,
      totalTradesAttemptedOnRage: totalTrades,
      totalTradesRevertedOnRage: totalRevesedTrades,
      // totalTradesOnFtx: totalTradesOnFtx,
    }

    // if (
    //   data.changeInSumOfMarketValue * -1 >
    //   0.01 * data.currentMarketValueSum
    // ) {
    //   log(
    //     `${BOT_WATCHER_ROLE} market value decreased by more than 1%`,
    //     'ARB_BOT'
    //   )
    // }

    log(JSON.stringify(data), 'ARB_BOT')
    console.log(JSON.stringify(data))
  }

  /** calculates the size of the potential arbitrage in ETH */
  const calculateSizeOfArbitrage = async (pRage: number, pFinal: number) => {
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
    console.log('-- arbitrage')
    pFtx = await ftx.queryFtxPrice()
    pRage = await rageTrade.queryRagePrice()

    const pFinal = calculateFinalPrice(pFtx, pRage, rageFee, ftxFee)
    console.log({ pFinal })

    if (isMovementWithinSpread(pFtx, pRage, pFinal) == true) {
      await log(
        `price movement is within spread, pFtx: ${pFtx}, pRage: ${pRage}, pFinal: ${pFinal}`,
        'ARB_BOT'
      )
      return
    }

    const { maxEthPosition: potentialArbSize } = await calculateSizeOfArbitrage(
      pRage,
      pFinal
    )
    console.log({ potentialArbSize })

    const ftxMargin = 20_000 // temp
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

    if (potentialArbProfit > STRATERGY_CONFIG.MIN_NOTIONAL_PROFIT) {
      let isSuccessful = false
      // const positionPostTrade = await ftx.updatePosition(updatedArbSize)

      try {
        await rageTrade.updatePosition(updatedArbSize, pFinal)
        isSuccessful = true
        totalTrades++
      } catch (e) {
        isSuccessful = false
        console.log(`error: reversing position on ftx, ${e}`)
        await log(
          `${BOT_WATCHER_ROLE} error: reversing position on ftx`,
          'ARB_BOT'
        )
        // await ftx.updatePosition(-updatedArbSize)
        totalTrades++
        totalRevesedTrades++
      }

      const [ragePrice, ragePosition] = await Promise.all([
        rageTrade.queryRagePrice(),
        (await rageTrade.getRagePosition()).eth,
      ])

      if (isSuccessful) {
        // const data = JSON.stringify({
        //   ftxNetSize: positionPostTrade.result[0].netSize,
        //   rageNetSize: ragePosition,
        //   ftxPrice: positionPostTrade.result[0].entryPrice,
        //   ragePrice: ragePrice,
        //   pFinal: pFinal,
        // })
        // console.log(data)
        // log(data, 'ARB_BOT')
      }
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

  cron.schedule(`*/${STRATERGY_CONFIG.FREQUENCY} * * * * *`, async () => {
    currentRuns++

    if (currentRuns === RUNS_TO_LOG_AFTER) {
      logState()
        .catch((e) =>
          log(`${BOT_WATCHER_ROLE} error in logging data, ${e.name}`, 'ARB_BOT')
        )
        .finally(() => {
          lastEthBal = currentEthBal
          lastRecordedAccountMarketValueSum =
            ftxAccountMarketValue + rageAccountMarketValue
          currentRuns = 0
          totalTrades = 0
          totalRevesedTrades = 0
        })
    }

    const startTime = Date.now()

    if (cronMutex) {
      await log(
        `${BOT_WATCHER_ROLE} SKIPPING ITERATION, BOT IS ALREADY ARBING`,
        'ARB_BOT'
      )
      return
    }
    cronMutex = true

    arbitrage()
      .then(() => {
        console.log('ARB RUN COMPLETE!')
      })
      .catch((error: Error) => {
        console.log('FROM ARBITRAGE: ', error.name, error.message)
      })
      .finally(() => {
        cronMutex = false
        log(`took ${Date.now() - startTime} to run arbitrage loop`, 'ARB_BOT')
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
  .catch((error) => console.log('FROM MAIN: ', error.message))
