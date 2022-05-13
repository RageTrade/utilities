import {
  formatUsdc,
  getContracts,
  getVaultContracts,
  parseUsdc,
  priceX128ToPrice,
  ClearingHouse,
  SwapSimulator,
  priceToTick,
  priceToSqrtPriceX96,
} from '@ragetrade/sdk'
import { providers, Wallet, BigNumber, BigNumberish } from 'ethers'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { AMM_CONFIG, NETWORK_INF0, STRATERGY_CONFIG } from '../../config'
import { getLatestAccountNumber } from '../../keeper-liquidation/common'
import { calculateFinalPrice, isMovementWithinSpread } from '../helpers'
import RageTrade from './index'

async function getLiquidityPosition(
  clearingHouse: ClearingHouse,
  accountNo: BigNumber,
  poolSerialNo: number,
  liquidityPositionSerialNo: number
) {
  const accountInfo = await clearingHouse.getAccountInfo(accountNo)
  return accountInfo.tokenPositions[poolSerialNo].liquidityPositions[
    liquidityPositionSerialNo
  ]
}

export async function getRealTokenBalances(
  clearingHouse: ClearingHouse,
  accountNo: BigNumber,
  collateralTokenAddress: String,
  settlementTokenAddress: String
): Promise<{
  collateralTokenBalance: BigNumber
  settlementTokenBalance: BigNumber
}> {
  const accountInfo = await clearingHouse.getAccountInfo(accountNo)
  const deposits = accountInfo.collateralDeposits
  let i = 0
  let collateralTokenBalance = BigNumber.from(0)
  let settlementTokenBalance = BigNumber.from(0)
  for (i; i < deposits.length; i++) {
    if (deposits[i].collateral == collateralTokenAddress)
      collateralTokenBalance = deposits[i].balance
    else if (deposits[i].collateral == settlementTokenAddress)
      settlementTokenBalance = deposits[i].balance
  }
  return { collateralTokenBalance, settlementTokenBalance }
}

export async function getNetTokenPosition(
  clearingHouse: ClearingHouse,
  accountNo: BigNumber,
  poolId: BigNumberish
): Promise<BigNumber> {
  return clearingHouse.getAccountNetTokenPosition(accountNo, poolId)
}

async function main() {
  const rageTrade = new RageTrade()
  await rageTrade.initialize()

  // console.log(rageTrade.currentFundingRate)

  // console.log("getRageNotionalPosition", await rageTrade.getRageNotionalPosition())
  // console.log("queryRagePrice", await rageTrade.queryRagePrice())
  // console.log("getRageNotionalPositionCap", await rageTrade.getRageNotionalPositionCap(0))
  // console.log("currentMarginFraction", await rageTrade.currentMarginFraction())
  // console.log("getRagePositionCap", await rageTrade.getRagePositionCap())
  // console.log("updatePosition", await rageTrade.updatePosition(2, 'buy'))

  // const { vQuoteIn, vTokenIn } = await rageTrade.getLiquidityInRange(2800, 2600)
  // console.log(formatEther(vTokenIn))
  // console.log(formatUsdc(vQuoteIn))

  // const pFinal = calculateFinalPrice(2390, 2117.69, 0.000665, 0.005)
  // console.log('pFinal', pFinal)
  // console.log(isMovementWithinSpread(2308, 2117.69, pFinal))

  const rt = await getContracts(
    new Wallet(
      NETWORK_INF0.PRIVATE_KEY,
      new providers.WebSocketProvider(
        NETWORK_INF0.WSS_RPC_URL,
        NETWORK_INF0.CHAIN_ID
      )
    )
  )

  // const markPrice = await rageTrade.queryRagePrice()
  // const indexPrice = await priceX128ToPrice(
  //   await rt.clearingHouse.getRealTwapPriceX128(AMM_CONFIG.POOL_ID),
  //   6,
  //   18
  // )

  // const currentRagePos = (await rt.clearingHouse.getAccountInfo(AMM_CONFIG.ACCOUNT_ID)).tokenPositions[0].netTraderPosition
  // const { marketValue } = await rt.clearingHouse.getAccountMarketValueAndRequiredMargin(AMM_CONFIG.ACCOUNT_ID, false)

  // const max = await rageTrade.getRagePositionCap()

  // console.log('mark price', markPrice)
  // console.log('index price', indexPrice)
  // console.log()

  // console.log('current rage positon', formatEther(currentRagePos))
  // console.log('account market value', formatUsdc(marketValue))
  // console.log()

  // console.log('max long', max.maxLong)
  // console.log('max short', max.maxShort)
  // console.log()

  // console.log('index price +4%', indexPrice * 1.04)
  // console.log('index price +-4%', indexPrice - indexPrice * 0.04)
  // console.log()

  // const {
  //   swapResult,
  // } = await (rt.swapSimulator as SwapSimulator).callStatic.simulateSwap(
  //   rt.clearingHouse.address,
  //   AMM_CONFIG.POOL_ID,
  //   BigNumber.from(2).pow(90).mul(-1),
  //   await priceToSqrtPriceX96(indexPrice * 1.04, 6, 18),
  //   false
  // )

  // console.log(formatEther(swapResult.vTokenIn))

  const addrs = await getVaultContracts(
    new Wallet(
      NETWORK_INF0.PRIVATE_KEY,
      new providers.WebSocketProvider(
        NETWORK_INF0.WSS_RPC_URL,
        NETWORK_INF0.CHAIN_ID
      )
    )
  )

  const addrs2 = await getContracts(
    new Wallet(
      NETWORK_INF0.PRIVATE_KEY,
      new providers.WebSocketProvider(
        NETWORK_INF0.WSS_RPC_URL,
        NETWORK_INF0.CHAIN_ID
      )
    )
  )

  const vault = await (
    await getVaultContracts(
      new Wallet(
        NETWORK_INF0.PRIVATE_KEY,
        new providers.WebSocketProvider(
          NETWORK_INF0.WSS_RPC_URL,
          NETWORK_INF0.CHAIN_ID
        )
      )
    )
  ).curveYieldStrategy

  const accNo = await getLatestAccountNumber(vault.address)

  const {
    tickLower,
    tickUpper,
    liquidity,
    vTokenAmountIn,
    sumALastX128,
    sumBInsideLastX128,
    sumFpInsideLastX128,
    sumFeeInsideLastX128,
    limitOrderType,
  } = await getLiquidityPosition(rt.clearingHouse, accNo, 0, 0)

  console.log('tickLower', tickLower.toString())
  console.log('tickUpper', tickUpper.toString())
  console.log('liquidity', liquidity.toString())
  console.log('vTokenAmountIn', vTokenAmountIn.toString())
  console.log('sumALastX128', sumALastX128.toString())
  console.log('sumBInsideLastX128', sumBInsideLastX128.toString())
  console.log('sumFpInsideLastX128', sumFpInsideLastX128.toString())
  console.log('sumFeeInsideLastX128', sumFeeInsideLastX128.toString())
  console.log('limitOrderType', limitOrderType.toString())

  const {
    collateralTokenBalance,
    settlementTokenBalance,
  } = await getRealTokenBalances(
    rt.clearingHouse,
    accNo,
    addrs.collateralToken.address,
    addrs2.settlementToken.address
  )
  console.log('collateralTokenBalance', collateralTokenBalance.toString())
  console.log('settlementTokenBalance', settlementTokenBalance.toString())

  const z = await getNetTokenPosition(
    rt.clearingHouse,
    accNo,
    AMM_CONFIG.POOL_ID
  )
  console.log('netTokenPostion', z.toString())
}

main()
  .then(() => console.log('completed'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
