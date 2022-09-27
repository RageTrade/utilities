import {
  ClearingHouse,
  findBlockByTimestamp,
  formatFundingRate,
  formatUsdc,
  getCoreContracts,
  parseUsdc,
  priceToPriceX128,
  priceToSqrtPriceX96,
  priceX128ToPrice,
  sqrtPriceX96ToPrice,
  SwapSimulator,
  tickToPrice,
  toQ128,
  VPoolWrapper,
  IUniswapV3Pool,
} from '@ragetrade/sdk'
import { ClearingHouseLens, IOracle } from '@ragetrade/sdk/dist/typechain/core'
import { BigNumber, providers, Wallet } from 'ethers'
import { formatEther, parseEther } from 'ethers/lib/utils'
import {
  AMM_CONFIG,
  ARB_GAS_UPPER_BOUND,
  BOT_WATCHER_ROLE,
  NETWORK_INF0,
  PRE_FLIGHT_CHECK,
  STRATERGY_CONFIG,
} from '../../config-env'
import { log } from '../../discord-logger'
import { InitOptions } from '../../types'

export default class RageTrade {
  private wallet
  private provider
  private accountId

  private isInitialized = false

  public currentFundingRate = 0

  private contracts: any

  constructor(initOptions: InitOptions) {
    this.provider = new providers.StaticJsonRpcProvider(
      NETWORK_INF0.HTTP_RPC_URL,
      NETWORK_INF0.CHAIN_ID
    )

    initOptions.isPriceArb
      ? (this.wallet = new Wallet(NETWORK_INF0.PK_PRICE_ARB_BOT, this.provider))
      : (this.wallet = new Wallet(
          NETWORK_INF0.PK_FUNDING_ARB_BOT,
          this.provider
        ))

    this.accountId = initOptions.rageAccountId
  }

  async initialize() {
    if (this.isInitialized) {
      throw new Error('RageTrade instance already initialized')
    }
    await this._setupContracts()
    await this._preFlightChecks()

    setInterval(async () => this._checkBlockFreshness(), 10 * 60 * 100)
    // setInterval(async () => {
    //   this.currentFundingRate = await this.getCurrentFundingRate()
    // }, 5 * 60 * 100)

    this.isInitialized = true
  }

  private async _setupContracts() {
    this.contracts = await getCoreContracts(this.wallet)
  }

  /** checks for fatal errors which should prevent arb transactions from occuring */
  private async _preFlightChecks() {
    if (
      (await this.wallet.getBalance()).toBigInt() <
      PRE_FLIGHT_CHECK.ARB_ETH_BAL_THRESHOLD
    ) {
      await log(`${BOT_WATCHER_ROLE} Arbitrum account out of gas`, 'ARB_BOT')
      throw new Error('Arbitrum account out of gas')
    }

    const accInfo = await (this.contracts
      .clearingHouseLens as ClearingHouseLens).getAccountInfo(this.accountId)

    if (accInfo.owner != this.wallet.address) {
      await log(
        '${BOT_WATCHER_ROLE} Account owner does not equal wallet address',
        'ARB_BOT'
      )
      throw new Error('Account owner does not equal wallet address')
    }
  }

  private async _checkBlockFreshness() {
    const latestBlock = await this.provider.getBlock(
      this.provider.getBlockNumber()
    )
    const diffNowSeconds = Math.floor(Date.now() / 1000) - latestBlock.timestamp

    if (diffNowSeconds > PRE_FLIGHT_CHECK.BLOCK_TIMESTAMP_FRESHNESS_THRESHOLD)
      throw new Error('Stale block/state or provider is lagging')
  }

  /** queries current Rage price from contracts */
  async queryRagePrice() {
    const { sqrtPriceX96 } = await (this.contracts
      .eth_vPool as IUniswapV3Pool).slot0()
    const price = await sqrtPriceX96ToPrice(sqrtPriceX96, 6, 18)

    return price
  }

  /** function returns total amount of tokens required to trade from current price to final/true price */
  async getLiquidityInRange(pCurrent: number, pFinal: number) {
    const maxValue =
      pFinal > pCurrent
        ? BigNumber.from(2).pow(90)
        : BigNumber.from(2).pow(90).mul(-1)

    const { swapResult } = await (this.contracts
      .swapSimulator as SwapSimulator).callStatic.simulateSwap(
      this.contracts.clearingHouse.address,
      AMM_CONFIG.POOL_ID,
      maxValue,
      await priceToSqrtPriceX96(pFinal, 6, 18),
      false
    )

    return {
      vTokenIn: swapResult.vTokenIn,
      vQuoteIn: swapResult.vQuoteIn,
    }
  }

  /** function determines maximum arbitrage trade size bot can take given opprotunity size and available margin */
  async calculateMaxTradeSize(
    ftxMargin: number,
    ftxEthPrice: number,
    potentialArbSize: number // this is signed ETH
  ) {
    const rageEthPrice = await this.queryRagePrice()
    const positionCaps = await this.getRagePositionCaps() // in USD
    let positionCap =
      potentialArbSize >= 0 ? positionCaps.maxLong : positionCaps.maxShort
    let maxSize = Math.min(
      positionCap / Math.max(rageEthPrice, ftxEthPrice),
      ftxMargin /
        Math.max(rageEthPrice, ftxEthPrice) /
        STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD
    )

    console.log('positionCaps', positionCaps)
    console.log('positionCap', positionCap)
    console.log('maxSize: ', maxSize)

    return (
      Math.min(Math.abs(potentialArbSize), maxSize) *
      Math.sign(potentialArbSize)
    )
  }

  async calculateTradeCost() {
    const ethPrice = await priceX128ToPrice(
      await (this.contracts.eth_oracle as IOracle).getTwapPriceX128(0),
      6,
      18
    )
    const gasPrice = await this.provider.getGasPrice()

    return Number(formatEther(gasPrice)) * ARB_GAS_UPPER_BOUND * ethPrice
  }

  /** calculates swap input and output tokens given trade size (if isNotional false, then potentialArbSize in ETH) */
  async simulateSwap(potentialArbSize: number, isNotional: boolean) {
    let arbSize
    isNotional
      ? (arbSize = parseUsdc(potentialArbSize.toString()))
      : (arbSize = parseEther(potentialArbSize.toString()))

    console.log('arbSize (from simulate)', arbSize.toString())

    const { swapResult } = await (this.contracts
      .swapSimulator as SwapSimulator).callStatic.simulateSwap(
      this.contracts.clearingHouse.address,
      AMM_CONFIG.POOL_ID,
      arbSize,
      0,
      isNotional
    )

    return {
      vTokenIn: swapResult.vTokenIn,
      vQuoteIn: swapResult.vQuoteIn,
    }
  }

  private async _currentMarginFraction() {
    const { netTraderPosition } = await (this.contracts
      .clearingHouseLens as ClearingHouseLens).getAccountTokenPositionInfo(
      this.accountId,
      AMM_CONFIG.POOL_ID
    )
    const priceX128 = await (this.contracts
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
      AMM_CONFIG.POOL_ID
    )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const { marketValue } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountMarketValueAndRequiredMargin(
      this.accountId,
      false
    )

    const openPositionNotional =
      Number(formatEther(netTraderPosition.abs())) * price

    const marketValueNotional = Number(formatUsdc(marketValue.abs()))

    return marketValueNotional / openPositionNotional
  }

  /** returns the max position sizes bot can take (in USD) for both Long and Short directions */
  async getRagePositionCaps() {
    const priceX128 = await (this.contracts // query current ETH twap price
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
      AMM_CONFIG.POOL_ID
    )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const { marketValue } = await (this.contracts // query Rage account current market value
      .clearingHouse as ClearingHouse).getAccountMarketValueAndRequiredMargin(
      this.accountId,
      false
    )

    if (marketValue.eq(0))
      throw new Error('Market value is 0, should not happend')

    const marketValueNotional = Number(formatUsdc(marketValue))

    const { netTraderPosition } = await (this.contracts
      .clearingHouseLens as ClearingHouseLens).getAccountTokenPositionInfo(
      this.accountId,
      AMM_CONFIG.POOL_ID
    )

    const currentPosition = netTraderPosition || BigNumber.from(0) // selects ETH position from positions

    const currentPositionNotional =
      Number(formatEther(currentPosition.abs())) * price
    const isLong = currentPosition.gte(0) ? 1 : -1

    const maxLong =
      marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD -
      currentPositionNotional * isLong
    const maxShort =
      marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD +
      currentPositionNotional * isLong

    return {
      maxLong,
      maxShort,
    }
  }

  /** simulates the margin ratio after a potential trade occurs */
  private async _simulatePostTrade(size: number) {
    const priceX128 = await (this.contracts
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
      AMM_CONFIG.POOL_ID
    )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const { marketValue } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountMarketValueAndRequiredMargin(
      this.accountId,
      false
    )

    const { netTraderPosition } = await (this.contracts
      .clearingHouseLens as ClearingHouseLens).getAccountTokenPositionInfo(
      this.accountId,
      AMM_CONFIG.POOL_ID
    )

    const marketValueEth = Number(formatUsdc(marketValue)) / price
    const currentPosition = netTraderPosition || BigNumber.from(0)
    const currentPositionEth = Number(formatEther(currentPosition))

    const newMarginFraction: number =
      currentPositionEth + size == 0
        ? Number.MAX_SAFE_INTEGER
        : marketValueEth / Math.abs(currentPositionEth + size)

    return newMarginFraction
  }

  /** makes a Rage trade */
  async updatePosition(size: number, priceLimit: number) {
    const amount = parseEther(size.toString())

    const oldMarginFraction = await this._currentMarginFraction()
    const newMarginFraction = await this._simulatePostTrade(size)

    if (newMarginFraction < STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD) {
      await log(
        `${BOT_WATCHER_ROLE} add more margin to RageTrade, margin fraction below ${STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD}, 
        margin fraction before: ${oldMarginFraction},
        margin fraction after current trade: ${newMarginFraction}
        `,
        'ARB_BOT'
      )
    }

    if (newMarginFraction < STRATERGY_CONFIG.HARD_MARGIN_RATIO_THRESHOLD) {
      await log(
        `${BOT_WATCHER_ROLE} RT: cannot take further position due to breach of max allowed margin fraction,
        margin fraction before: ${oldMarginFraction},
        margin fraction after current trade: ${newMarginFraction}     
        `,
        'ARB_BOT'
      )
      throw new Error(
        'RT: cannot take further position due to breach of max allowed margin fraction'
      )
    }

    const trade = await (this.contracts
      .clearingHouse as ClearingHouse).swapToken(
      this.accountId,
      AMM_CONFIG.POOL_ID,
      {
        amount: amount,
        sqrtPriceLimit: await priceToSqrtPriceX96(priceLimit, 6, 18),
        isNotional: false,
        settleProfit: false,
        isPartialAllowed: false,
      }
    )

    await trade.wait()
    return trade
  }

  /** gets Rage position in both ETH and USD terms */
  async getRagePosition() {
    const { netTraderPosition } = await (this.contracts
      .clearingHouseLens as ClearingHouseLens).getAccountPositionInfo(
      this.accountId,
      AMM_CONFIG.POOL_ID
    )
    const priceX128 = await (this.contracts
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
      AMM_CONFIG.POOL_ID
    )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const position = netTraderPosition || BigNumber.from(0)

    return {
      eth: formatEther(position),
      notional: Number(formatEther(position)) * price,
    }
  }

  async getCurrentFundingRate() {
    const eth_vPool: IUniswapV3Pool = this.contracts.eth_vPool
    const eth_vPoolWrapper: VPoolWrapper = this.contracts.eth_vPoolWrapper

    const fpStateCurrent = await eth_vPoolWrapper.fpGlobal()
    const fpStateOld = await eth_vPoolWrapper.fpGlobal({
      blockTag: (
        await findBlockByTimestamp(
          this.wallet.provider,
          Math.floor(Date.now() / 1000) - 3600,
          { allowFutureTimestamp: true }
        )
      ).number,
    })

    const result = await eth_vPool.observe([3600, 0])

    const tickCumulativesDelta = result.tickCumulatives[1].sub(
      result.tickCumulatives[0]
    )
    let timeWeightedAverageTick = tickCumulativesDelta.div(3600)

    if (
      tickCumulativesDelta.lt(0) &&
      !tickCumulativesDelta.mod(3600).isZero()
    ) {
      timeWeightedAverageTick = timeWeightedAverageTick.sub(1)
    }

    const priceX128 = await priceToPriceX128(
      await tickToPrice(timeWeightedAverageTick.toNumber(), 6, 18),
      6,
      18
    )

    return formatFundingRate(
      fpStateCurrent.sumAX128
        .sub(fpStateOld.sumAX128)
        .mul(toQ128(1))
        .div(priceX128)
        .div(3600)
    )
  }

  async getRageMarketValue() {
    const { marketValue } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountMarketValueAndRequiredMargin(
      this.accountId,
      false
    )

    return Number(formatUsdc(marketValue))
  }

  async getEthBalanceAndNonce() {
    const [ethBal, nonce] = await Promise.all([
      this.wallet.getBalance(),
      this.wallet.getTransactionCount(),
    ])

    return {
      ethBal: Number(formatEther(ethBal)),
      nonce: nonce,
    }
  }
}
