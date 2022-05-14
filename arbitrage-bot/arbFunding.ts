import Ftx from './ftx'
import cron from 'node-cron'
import RageTrade from './rage-trade'
import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config'
import { formatEther } from 'ethers/lib/utils'
import { estimateFundingArbProfit } from './helpers'

// past '10' min MA on rage
// test

const ftx = new Ftx()
const rageTrade = new RageTrade()

/** arbitrage entrypoint */
const main = async () => {
  await ftx.initialize()
  await rageTrade.initialize()

  const ftxFee = ftx.takerFee
  const rageFee = rageTrade.ammConfig.FEE
  const minimumFundingDifferenceThresh = 0.001

  let pFtx = await ftx.queryFtxPrice()
  let pRage = await rageTrade.queryRagePrice()

  console.log('currentFundingRate', rageTrade.currentFundingRate)
  let rageFunding = rageTrade.currentFundingRate
  let ftxFunding = ftx.currentFundingRate // make the same units as rageFunding
  let fundingDifference = ftxFunding - rageFunding // if + long rage, if - short rage

  /** calculates the max size of a Rate arbitrage (point where price arb still doesn't exist) */
  const calculateSizeOfRateArbitrage = async (
    pRage: number,
    pFtx: number,
    fundingDifference: number
  ) => {
    let fundingSign = fundingDifference > 0 ? 1 : -1
    let pFinal = fundingSign // past this price, there is arb opprotunity
      ? (pFtx * (1 + ftxFee)) / (1 - rageFee) // long rage, short ftx
      : (pFtx * (1 - ftxFee)) / (1 + rageFee) // short rage, long ftx

    let maxEthPosition = 0
    if ((pFinal - pRage) * fundingSign > 0) {
      const { vTokenIn } = await rageTrade.getLiquidityInRange(pRage, pFtx)
      maxEthPosition = -Number(formatEther(vTokenIn)) // max directional eth position
    }

    return {
      maxEthPosition,
    }
  }

  /** checks for arb and if found, executes the arb */
  const arbitrage = async () => {
    pFtx = await ftx.queryFtxPrice()
    pRage = await rageTrade.queryRagePrice()

    rageFunding = rageTrade.currentFundingRate
    ftxFunding = ftx.currentFundingRate // make the same units as rageFunding
    fundingDifference = ftxFunding - rageFunding // if + long rage, if - short rage

    console.log('rageFunding', rageFunding)
    console.log('ftxFunding', ftxFunding)
    console.log('fundingDifference', fundingDifference)

    if (Math.abs(fundingDifference) < minimumFundingDifferenceThresh) {
      console.log('No meaningful funding rate difference to arb')
      return
    }

    let {
      maxEthPosition: potentialArbSize,
    } = await calculateSizeOfRateArbitrage(pRage, pFtx, fundingDifference)

    const ftxMargin = await ftx.queryFtxMargin()
    const updatedArbSize = await rageTrade.calculateMaxTradeSize(
      ftxMargin,
      pFtx,
      potentialArbSize
    )

    console.log('pFtx', pFtx)
    console.log('pRage', pRage)
    console.log('ftxMargin', ftxMargin)
    console.log('potentialArbSize', potentialArbSize)
    console.log('updatedArbSize', updatedArbSize)

    const tradeCost = await rageTrade.calculateTradeCost()

    const estimatedArbProfit = await estimateFundingArbProfit(
      Number(updatedArbSize.toFixed(6)),
      fundingDifference,
      tradeCost
    )

    if (estimatedArbProfit > rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT) {
      const x = await ftx.updatePosition(updatedArbSize)
      const y = await rageTrade.updatePosition(updatedArbSize)

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
