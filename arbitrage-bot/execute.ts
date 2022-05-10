import Ftx from './ftx'
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
    pFinal: number,
    arbAsset: 'ETH' | 'USDC',
    potentialArbSize: number,
  ) => {
    let usdProfit = 0;

    if (arbAsset === 'ETH') {
      const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(potentialArbSize, pFinal, false)
      const ethPriceReceived = Number(formatUsdc(vQuoteIn.abs())) / potentialArbSize

      console.log('vTokenIn', formatEther(vTokenIn.abs()))
      console.log('vQuoteIn', formatUsdc(vQuoteIn.abs()))
      console.log('ethPriceReceived', ethPriceReceived)

      console.log('potentialArbSize (from calc arb profit)', potentialArbSize)

      usdProfit = potentialArbSize * (ethPriceReceived - pFtx * (1 + ftxFee))

      console.log('usdProfit', usdProfit)
    }

    if (arbAsset === 'USDC') {
      const { vQuoteIn, vTokenIn } = await rageTrade.simulateSwap(potentialArbSize, pFinal, true)
      const ethPriceReceived = potentialArbSize / Number(formatEther(vTokenIn.abs()))

      console.log('vTokenIn', formatEther(vTokenIn.abs()))
      console.log('vQuoteIn', formatUsdc(vQuoteIn.abs()))
      console.log('ethPriceReceived', ethPriceReceived)

      console.log('potentialArbSize (from calc arb profit)', potentialArbSize)

      usdProfit = potentialArbSize / (ethPriceReceived - pFtx * (1 - ftxFee))

      console.log('usdProfit', usdProfit)
    }

    const tradeCost = await rageTrade.calculateTradeCost()

    return usdProfit - tradeCost
  }

  const arbitrage = async () => {
    const pFinal = calculateFinalPrice(pFtx, pRage, rageFee, ftxFee)

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

    const potentialArbProfit = await calculateArbProfit(pFtx, pFinal, arbAsset, updatedArbSize)

    console.log('potentialArbProfit', potentialArbProfit)
    console.log(rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT)

    if (potentialArbProfit > rageTrade.stratergyConfig.MIN_NOTIONAL_PROFIT) {

      const ftxSide: OrderSide = arbAsset === 'ETH' ? 'sell' : 'buy'
      const rageSide: OrderSide = arbAsset === 'ETH' ? 'buy' : 'sell'

      const ftxQuantity = arbAsset === 'ETH' ? updatedArbSize : updatedArbSize / pFtx
      const rageQuantity = arbAsset === 'ETH' ? updatedArbSize : updatedArbSize / pRage

      const x = await ftx.updatePosition(ftxQuantity, ftxSide)
      const y = await rageTrade.updatePosition(rageQuantity, rageSide)

      await log(`arb successful, ${x.result}, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${y.hash}`, 'ARB_BOT')
    }
  }

  arbitrage()
}

main()