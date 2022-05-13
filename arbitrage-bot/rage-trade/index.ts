import {
  ClearingHouse,
  formatUsdc,
  getContracts,
  parseUsdc,
  priceToSqrtPriceX96,
  priceX128ToPrice,
  sqrtPriceX96ToPrice,
  SwapSimulator,
} from '@ragetrade/sdk'
import { IUniswapV3Pool } from '@ragetrade/sdk/dist/typechain/vaults'
import { BigNumber, providers, Wallet } from 'ethers'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { OrderSide } from 'ftx-api'
import {
  AMM_CONFIG,
  NETWORK_INF0,
  PRE_FLIGHT_CHECK,
  STRATERGY_CONFIG,
} from '../../config'
import { log } from '../../discord-logger'

export default class RageTrade {
  private wallet
  private provider

  private isInitialized = false

  public currentFundingRate = 0

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
  }

  async initialize() {
    if (this.isInitialized) {
      throw new Error('RageTrade instance already initialized')
    }
    await this._setupContracts()
    await this._preFlightChecks()

    setInterval(async () => this._checkBlockFreshness, 10 * 60 * 100)
    setInterval(async () => this._updateCurrentFundingRate, 5 * 60 * 100)

    this.isInitialized = true
  }

  private async _setupContracts() {
    this.contracts = await getContracts(this.wallet)
  }

  /** checks for fatal errors which should prevent arb transactions from occuring */
  private async _preFlightChecks() {
    if (
      (await this.wallet.getBalance()).toBigInt() <
      this.preFlightCheck.ARB_ETH_BAL_THRESHOLD
    ) {
      await log('Arbitrum account out of gas', 'ARB_BOT')
      throw new Error('Arbitrum account out of gas')
    }

    const accInfo = await this.contracts.clearingHouse.getAccountInfo(
      this.ammConfig.ACCOUNT_ID
    )

    if (accInfo.owner != this.wallet.address) {
      await log('Account owner does not equal wallet address', 'ARB_BOT')
      throw new Error('Account owner does not equal wallet address')
    }
  }

  private async _checkBlockFreshness() {
    const latestBlock = await this.provider.getBlock(
      this.provider.getBlockNumber()
    )
    const diffNowSeconds = Math.floor(Date.now() / 1000) - latestBlock.timestamp

    if (
      diffNowSeconds > this.preFlightCheck.BLOCK_TIMESTAMP_FRESHNESS_THRESHOLD
    )
      throw new Error('Stale block/state or provider is lagging')
  }

  private async _updateCurrentFundingRate() {
    const [chainlinkTWAP, perpTWAP] = await Promise.all([
      (this.contracts.clearingHouse as ClearingHouse).getRealTwapPriceX128(
        this.ammConfig.POOL_ID
      ),
      (this.contracts.clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
        this.ammConfig.POOL_ID
      ),
    ])

    const num1 = Number(formatEther(chainlinkTWAP))
    const num2 = Number(formatEther(perpTWAP))

    this.currentFundingRate = (num2 - num1) / num1 / 24

    console.log(this.currentFundingRate)
  }

  // add deviation check
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
        this.ammConfig.POOL_ID,
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

  // for arb testnet, arbgas returned is 0, so making is constant(1$) for now
  async calculateTradeCost() {
    // should query Arbitrum mainnet gas price
    return 1
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
        this.ammConfig.POOL_ID,
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
    const account = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountInfo(this.ammConfig.ACCOUNT_ID)
    const priceX128 = await (this.contracts
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
        this.ammConfig.POOL_ID
      )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const { marketValue } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountMarketValueAndRequiredMargin(
        this.ammConfig.ACCOUNT_ID,
        false
      )

    const openPositionNotional =
      Number(formatEther(account.tokenPositions[0]?.netTraderPosition.abs() || BigNumber.from(0))) * price

    const marketValueNotional = Number(formatUsdc(marketValue.abs()))

    return marketValueNotional / openPositionNotional
  }

  /** returns the max position sizes bot can take (in USD) for both Long and Short directions */
  async getRagePositionCaps() {
    const priceX128 = await (this.contracts // query current ETH twap price
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
        this.ammConfig.POOL_ID
      )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const { marketValue } = await (this.contracts // query Rage account current market value
      .clearingHouse as ClearingHouse).getAccountMarketValueAndRequiredMargin(
        this.ammConfig.ACCOUNT_ID,
        false
      )

    if (marketValue.eq(0))
      throw new Error('Market value is 0, should not happend')

    const marketValueNotional = Number(formatUsdc(marketValue))

    const { tokenPositions } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountInfo(this.ammConfig.ACCOUNT_ID)

    const currentPosition = tokenPositions[0]?.netTraderPosition || BigNumber.from(0) // selects ETH position from positions
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
        this.ammConfig.POOL_ID
      )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const { marketValue } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountMarketValueAndRequiredMargin(
        this.ammConfig.ACCOUNT_ID,
        false
      )

    const { tokenPositions } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountInfo(this.ammConfig.ACCOUNT_ID)

    const marketValueEth = Number(formatUsdc(marketValue)) / price
    const currentPosition = tokenPositions[0]?.netTraderPosition || BigNumber.from(0)
    const currentPositionEth = Number(formatEther(currentPosition))

    const newMarginFraction: number =
      currentPositionEth + size == 0
        ? Number.MAX_SAFE_INTEGER
        : marketValueEth / Math.abs(currentPositionEth + size)

    return newMarginFraction
  }

  /** makes a Rage trade */
  async updatePosition(size: number) {
    const amount = parseEther(size.toString())

    const oldMarginFraction = await this._currentMarginFraction()
    const newMarginFraction = await this._simulatePostTrade(size)

    if (newMarginFraction < STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD) {
      await log(
        `add more margin to RageTrade, margin fraction below ${STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD}, 
        margin fraction before: ${oldMarginFraction},
        margin fraction after current trade: ${newMarginFraction}
        `,
        'ARB_BOT'
      )
    }

    if (newMarginFraction < STRATERGY_CONFIG.HARD_MARGIN_RATIO_THRESHOLD) {
      await log(
        `cannot take further position due to breach of max allowed margin fraction,
        margin fraction before: ${oldMarginFraction},
        margin fraction after current trade: ${newMarginFraction}     
        `,
        'ARB_BOT'
      )
      throw new Error(
        'cannot take further position due to breach of max allowed margin fraction'
      )
    }

    const trade = await (this.contracts
      .clearingHouse as ClearingHouse).swapToken(
        this.ammConfig.ACCOUNT_ID,
        this.ammConfig.POOL_ID,
        {
          amount: amount,
          sqrtPriceLimit: 0,
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
    const { tokenPositions } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountInfo(this.ammConfig.ACCOUNT_ID)
    const priceX128 = await (this.contracts
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
        this.ammConfig.POOL_ID
      )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const position = tokenPositions[0]?.netTraderPosition || BigNumber.from(0)

    return {
      eth: formatEther(position),
      notional: Number(formatEther(position)) * price,
    }
  }
}
