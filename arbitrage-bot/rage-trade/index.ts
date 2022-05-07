import {
  AMM_CONFIG,
  NETWORK_INF0,
  STRATERGY_CONFIG,
  PRE_FLIGHT_CHECK,
} from '../../config'

import { Side, NetRagePosition } from '../../types'

import { Wallet, providers, BigNumber, BigNumberish } from 'ethers'

import {
  getContracts,
  IERC20Metadata,
  IOracle,
  IUniswapV3Pool,
  priceX128ToPrice,
  VPoolWrapper,
  VToken,
  truncate,
  sqrtPriceX96ToPrice,
} from '@ragetrade/sdk'

import {
  tickToPrice,
  priceToClosestTick,
  isSorted,
  LiquidityMath,
  maxLiquidityForAmounts,
  TickList,
  TickMath,
} from '@uniswap/v3-sdk'

import { log } from '../../discord-logger'

import { Price, Token } from '@uniswap/sdk-core'

export default class RageTrade {
  private wallet
  private provider

  public netRagePosition: NetRagePosition

  private isInitialized = false

  private token0: Token
  private token1: Token

  public ethPrice: number = 0
  public currentFundingRate: BigNumberish = 0

  private contracts: any

  constructor(
    readonly ammConfig = AMM_CONFIG,
    readonly networkInfo = NETWORK_INF0,
    readonly preFlightCheck = PRE_FLIGHT_CHECK,
    readonly stratergyConfig = STRATERGY_CONFIG
  ) {
    this.provider = new providers.WebSocketProvider(
      this.networkInfo.WSS_RPC_URL,
      this.networkInfo.CHAIN_ID
    )

    this.wallet = new Wallet(this.networkInfo.PRIVATE_KEY, this.provider)

    this.netRagePosition = {
      netSide: Side.BUY,
      availableMargin: 0,
      netTokenPosition: {
        vTokenAmount: BigNumber.from(0),
        tickLower: 0,
        tickUpper: 0,
      },
      accountMarketValue: 0,
      lastUpdated: Date.now(),
      lastTradedFundingRate: 0,
    }
  }

  async initialize() {
    if (this.isInitialized) {
      throw new Error('RageTrade instance already initialized')
    }
    await this._setupContracts()
    await this._preFlightChecks()

    this.token0 = new Token(
      this.networkInfo.CHAIN_ID,
      this.contracts.eth_vToken.address,
      await this.contracts.eth_vToken.decimals()
    )

    this.token1 = new Token(
      this.networkInfo.CHAIN_ID,
      this.contracts.vQuote.address,
      await this.contracts.vQuote.decimals()
    )

    setInterval(async () => this._checkBlockFreshness, 10 * 60 * 100)
    setInterval(async () => this._updatePricesFromOracle, 3 * 60 * 100)
    setInterval(async () => this._updateCurrentFundingRate, 5 * 60 * 100)

    this.isInitialized = true
  }

  private async _setupContracts() {
    this.contracts = await getContracts(this.wallet)
  }

  private async _preFlightChecks() {
    let checks = false

    ;(await this.wallet.getBalance()).toBigInt() <
    this.preFlightCheck.ARB_ETH_BAL_THRESHOLD
      ? (checks = true)
      : null

    const accInfo = await this.contracts.clearingHouse.getAccountInfo(
      this.ammConfig.ACCOUNT_ID
    )

    accInfo.owner != this.wallet.address ? (checks = true) : null

    if (accInfo.collateralDeposits.length) {
      accInfo.collateralDeposits[0].balance.toBigInt() <
      this.preFlightCheck.RAGETRADE_BAL_THRESHOLD
        ? (checks = true)
        : null
    } else {
      checks = true
    }

    if (checks) throw new Error('Failed one or more pre-flight checks')
  }

  private async _checkBlockFreshness() {
    const latestBlockNumber = await this.provider.getBlockNumber()
    const latestBlock = await this.provider.getBlock(latestBlockNumber)
    const diffNowSeconds = Math.floor(Date.now() / 1000) - latestBlock.timestamp

    if (
      diffNowSeconds > this.preFlightCheck.BLOCK_TIMESTAMP_FRESHNESS_THRESHOLD
    ) {
      throw new Error('Stale block/state or provider is lagging')
    }
  }

  private async _updatePricesFromOracle() {
    const price = await this.contracts.eth_oracle.getTwapPriceX128(300)
    this.ethPrice = await priceX128ToPrice(
      price,
      await this.contracts.settlementToken.decimals(),
      await this.contracts.eth_vToken.decimals()
    )
    console.log(this.ethPrice)
  }

  private async _updateCurrentFundingRate() {
    const [
      chainlinkTWAP,
      perpTWAP,
    ] = await this.contracts.clearingHouse.getTwapPrices(
      this.contracts.ETH_vTokenDeployment
    )

    this.currentFundingRate =
      (perpTWAP.toBigInt() - chainlinkTWAP.toBigInt()) /
      chainlinkTWAP.toBigInt() /
      24
  }

  private async _updateNetPosition() {
    const values = await this.contracts.clearingHouse.getAccountInfo(
      this.ammConfig.ACCOUNT_ID
    )
    this.netRagePosition.availableMargin = values.collateralDeposits[0].balance

    const netPostion = values.tokenPositions[0].netTraderPosition.abs() // (ETH Long - Eth Short)
    netPostion.toBigInt() > 0
      ? (this.netRagePosition.netSide = Side.BUY)
      : (this.netRagePosition.netSide = Side.SELL)

    this.netRagePosition.netTokenPosition = {
      vTokenAmount:
        values.tokenPositions[0].liquidityPositions[0].vTokenAmountIn,
      tickUpper: values.tokenPositions[0].liquidityPositions[0].tickUpper,
      tickLower: values.tokenPositions[0].liquidityPositions[0].tickLower,
    }

    const amv = await this.contracts.clearingHouse.getAccountMarketValueAndRequiredMargin(
      this.ammConfig.ACCOUNT_ID,
      true
    )
    this.netRagePosition.accountMarketValue = amv.accountMarketValue

    this.netRagePosition.lastUpdated = Date.now()
  }

  private async _preTxnChecks() {
    // account bal / adding
    // funding rate
    // margin ratio
  }

  private async _postTxnCalcs() {
    await this._updateNetPosition()
  }

  async queryRagePrice() {
    const { sqrtPriceX96 } = await this.contracts.eth_vPool.slot0()
    return await sqrtPriceX96ToPrice(
      sqrtPriceX96,
      await this.contracts.settlementToken.decimals(),
      await this.contracts.eth_vToken.decimals()
    )
  }

  async queryRelevantUniV3Liquidity(pCurrent: number, pFinal: number) {
    const priceCurrent = new Price(this.token0, this.token1, pCurrent, 1)
    const priceFinal = new Price(this.token0, this.token1, pFinal, 1)

    let tickLow = priceToClosestTick(priceCurrent)
    let tickHigh = priceToClosestTick(priceFinal)

    let spacing = await this.contracts.eth_vPool.tickSpacing()

    if (tickLow > tickHigh) {
      ;[tickLow, tickHigh] = [tickHigh, tickLow]
    }

    let tickPrices: BigInt[] = []
    let tickLiquidities: BigInt[] = []

    while (tickLow <= tickHigh) {
      const {
        liquidityGross,
        liquidityNet,
        feeGrowthOutside0X128,
        feeGrowthOutside1X128,
        tickCumulativeOutside,
        secondsPerLiquidityOutsideX128,
        secondsOutside,
        initialized,
      } = await this.contracts.eth_vPool.ticks(tickLow)

      if (initialized) {
        tickPrices.push(BigInt(tickLow))
        tickLiquidities.push(liquidityNet.toBigInt())
      }

      tickLow += spacing
    }

    return {
      tickPrices,
      tickLiquidities,
    }
  }

  async calculateMaxTradeSize(
    potentialArbSize: number,
    side: Side,
    pFtx: number,
    ftxFee: number
  ) {
    let usdProfit = 0

    if ((side = Side.BUY)) {
      // buying eth on rage trade

      const ethRecieved = await sqrtPriceX96ToPrice(
        (await this.simulateSwap(BigNumber.from(potentialArbSize))).output
          .sqrtPriceX96End,
        await this.contracts.settlementToken.decimals(),
        await this.contracts.eth_vToken.decimals()
      )
      const ethPriceRecieved = potentialArbSize / ethRecieved
      usdProfit = potentialArbSize * (pFtx * (1 - ftxFee) - ethPriceRecieved)
    } else {
      // selling eth on rage trade

      let usdRecieved = await sqrtPriceX96ToPrice(
        (await this.simulateSwap(BigNumber.from(potentialArbSize))).output
          .sqrtPriceX96End,
        await this.contracts.settlementToken.decimals(),
        await this.contracts.eth_vToken.decimals()
      )
      usdRecieved = usdRecieved * this.ethPrice
      const ethPriceRecieved = usdRecieved / potentialArbSize
      usdProfit = potentialArbSize * (ethPriceRecieved - pFtx * (1 + ftxFee))
    }

    return usdProfit - (await this.calculateTradeCost(0)) // TODO: change to ticks crossed
  }

  async calculateTradeCost(ticksCrossed: number) {
    return ticksCrossed // TODO: change to gas calc
  }

  calculateQuoteUsed(
    lowerPrice: number,
    upperPrice: number,
    liquidity: BigNumber
  ) {
    return liquidity.mul(Math.sqrt(upperPrice) - Math.sqrt(lowerPrice))
  }

  calculateBaseUsed(
    upperPrice: number,
    lowerPrice: number,
    liquidity: BigNumber
  ) {
    const numerator = Math.sqrt(upperPrice) - Math.sqrt(lowerPrice)
    const denominator = Math.sqrt(lowerPrice) * Math.sqrt(upperPrice)

    return liquidity.mul(numerator / denominator)
  }

  async getQuoteAssetUsed(
    pRage: number,
    pFinal: BigInt,
    filteredTickPrices: BigInt[],
    tickLiquidities: BigInt[]
  ) {
    const nTicks = filteredTickPrices.length
    let currentTick = filteredTickPrices[0]

    let quoteUsed = BigInt(0)

    for (let i = 0; i < nTicks - 1; i++) {
      quoteUsed += this.calculateQuoteUsed(
        Math.max(pRage, Number(currentTick)),
        Number(filteredTickPrices[i + 1]),
        BigNumber.from(tickLiquidities[i])
      ).toBigInt()

      currentTick = filteredTickPrices[i + 1]
    }

    quoteUsed += this.calculateQuoteUsed(
      Math.max(pRage, Number(currentTick)),
      Number(pFinal),
      BigNumber.from(tickLiquidities[-1])
    ).toBigInt()

    return quoteUsed
  }

  async getBaseAssetUsed(
    pRage: number,
    pFinal: BigInt,
    filteredTickPrices: BigInt[],
    tickLiquidities: BigInt[]
  ) {
    const nTicks = filteredTickPrices.length
    let currentTick = filteredTickPrices[-1]

    let baseUsed = this.calculateBaseUsed(
      pRage,
      Number(currentTick),
      BigNumber.from(tickLiquidities[-1])
    ).toBigInt()

    for (let i = 0; i < nTicks - 1; i++) {
      baseUsed += this.calculateBaseUsed(
        Number(currentTick),
        Math.max(Number(pFinal), Number(filteredTickPrices[-(i + 2)])),
        BigNumber.from(tickLiquidities[-(i + 2)])
      ).toBigInt()

      currentTick = filteredTickPrices[-(i + 2)]
    }

    return baseUsed
  }

  async simulateSwap(potentialArbSize: BigNumberish) {
    const output = await this.contracts.swapSimulator.callStatic.simulateSwap(
      this.contracts.ClearingHouseDeployment,
      truncate(this.contracts.ETH_vTokenDeployment),
      potentialArbSize,
      0,
      true
    )

    const price =
      (await sqrtPriceX96ToPrice(
        output.sqrtPriceX96End,
        await this.contracts.settlementToken.decimals(),
        await this.contracts.eth_vToken.decimals()
      )) * this.ethPrice

    return {
      output,
      price,
    }
  }

  async getRageEthPositionCap(ftxEthMargin: number): Promise<BigInt> {
    const decimals = await this.contracts.settlementToken.decimals()
    const rawValue =
      (this.netRagePosition.accountMarketValue as BigNumber).toBigInt() /
      BigInt(10 ** decimals)
    const rageEthMargin = rawValue / BigInt(this.ethPrice as number)

    if (ftxEthMargin > rageEthMargin) {
      return rageEthMargin * BigInt(this.stratergyConfig.LOCAL_MAX_LEVERAGE)
    } else {
      return (
        BigInt(ftxEthMargin) * BigInt(this.stratergyConfig.LOCAL_MAX_LEVERAGE)
      )
    }
  }

  async getRageNotionalPositionCap(ftxUsdMargin: number): Promise<BigInt> {
    const decimals = await this.contracts.settlementToken.decimals()
    const rageUsdMargin =
      (this.netRagePosition.accountMarketValue as BigNumber).toBigInt() /
      BigInt(10 ** decimals)

    if (ftxUsdMargin > rageUsdMargin) {
      return rageUsdMargin * BigInt(this.stratergyConfig.LOCAL_MAX_LEVERAGE)
    } else {
      return (
        BigInt(ftxUsdMargin) * BigInt(this.stratergyConfig.LOCAL_MAX_LEVERAGE)
      )
    }
  }

  async getRageNotionalPosition() {
    this.netRagePosition.netTokenPosition.vTokenAmount.toBigInt() *
      BigInt(this.ethPrice)
  }
}
