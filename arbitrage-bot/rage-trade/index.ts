import {
  ClearingHouse,
  formatUsdc,
  getContracts,
  parseUsdc,
  priceToSqrtPriceX96, priceX128ToPrice,
  sqrtPriceX96ToPrice,
  SwapSimulator
} from '@ragetrade/sdk'
import { IUniswapV3Pool } from '@ragetrade/sdk/dist/typechain/vaults'
import { BigNumber, providers, Wallet } from 'ethers'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { OrderSide } from 'ftx-api'
import {
  AMM_CONFIG,
  NETWORK_INF0,
  PRE_FLIGHT_CHECK,
  STRATERGY_CONFIG
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

  private async _preFlightChecks() {
    // should have custom error messages for out of gas and wrong owner errors
    let checks = false

    ;(await this.wallet.getBalance()).toBigInt() <
    this.preFlightCheck.ARB_ETH_BAL_THRESHOLD
      ? (checks = true)
      : null

    const accInfo = await this.contracts.clearingHouse.getAccountInfo(
      this.ammConfig.ACCOUNT_ID
    )

    accInfo.owner != this.wallet.address ? (checks = true) : null

    if (checks) throw new Error('Failed one or more pre-flight checks') // replace generic with custom errors
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
  async queryRagePrice() {
    // const priceX128 = await (this.contracts
    //   .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(this.ammConfig.POOL_ID)
    // const price = await priceX128ToPrice(priceX128, 6, 18)

    const { sqrtPriceX96 } = await (this.contracts
      .eth_vPool as IUniswapV3Pool).slot0()
    const price = await sqrtPriceX96ToPrice(sqrtPriceX96, 6, 18)

    return price
  }

  async getLiquidityInRange(pCurrent: number, pFinal: number) {
    // pFinal < Pcurrent => BigNumber.from(10).pow(28) * -1

    // VToken -ve for long
    // VToken +ve for short
    const maxValue =
      pFinal > pCurrent
        ? BigNumber.from(2).pow(90)
        : BigNumber.from(2).pow(90).mul(-1)

    // console.log('priceToSqrtPriceX96', await priceToSqrtPriceX96(pFinal, 6, 18))
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

  async calculateMaxTradeSize(
    ftxMargin: number,
    ftxEthPrice: number,
    potentialArbSize: number,
    arbAsset: 'ETH' | 'USDC'
  ) {
    const price = await this.queryRagePrice()
    const positionCap = await this.getRagePositionCap()

    console.log('positionCap', positionCap)

    let maxSize = 0

    if (arbAsset === 'ETH') {
      // maxLong looks like USD, is this comparing USD to ETH?
      maxSize = Math.min(
        positionCap.maxLong,
        ftxMargin / ftxEthPrice / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD
      ) // these units don't seem right
      // if maxLong is USD and ftxMargin is in USD (and desired result is ETH), should be:
      // maxSize = Math.min(positionCap.maxLong / ftxEthPrice, ftxMargin / ftxEthPrice / 0.5)
    }

    if (arbAsset === 'USDC') {
      // maxShort looks like USD. why multiply by price, doesn't seem right
      maxSize = Math.min(
        positionCap.maxShort * price,
        ftxMargin / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD
      )
      // if maxLong is USD and ftxMargin is USD (and desired result is USD), should be:
      // maxSize = Math.min(positionCap.maxShort, ftxMargin / 0.5)
    }

    console.log(`maxSize, ${arbAsset}`, maxSize)

    return Math.min(potentialArbSize, maxSize) // comparison depends on units
  }

  // for arb testnet, arbgas returned is 0, so making is constant(1$) for now
  async calculateTradeCost() {
    // should query Arbitrum mainnet gas price or set conservative value (ie $5)
    return 1
  }

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
      Number(formatEther(account.tokenPositions[0].netTraderPosition.abs())) *
      price

    const marketValueNotional = Number(formatUsdc(marketValue.abs()))

    return marketValueNotional / openPositionNotional
  }

  async getRagePositionCap() {
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

    if (marketValue.eq(0))
      throw new Error('Market value is 0, should not happend')

    const marketValueNotional = Number(formatUsdc(marketValue))

    const { tokenPositions } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountInfo(this.ammConfig.ACCOUNT_ID)

    const currentPosition = tokenPositions[0].netTraderPosition || 0
    const currentPositionNotional =
      Number(formatEther(currentPosition.abs())) * price

    let maxLong = 0,
      maxShort = 0

    if (currentPosition.gt(0)) {
      maxLong =
        marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD -
        currentPositionNotional
      maxShort =
        marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD +
        currentPositionNotional
    } else if (currentPosition.lt(0)) {
      maxLong =
        marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD +
        currentPositionNotional
      maxShort =
        marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD -
        currentPositionNotional
    } else {
      maxLong =
        marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD
      maxShort =
        marketValueNotional / STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD
    }

    return {
      maxLong,
      maxShort,
    }
  }

  private async _simulatePostTrade(size: number, side: OrderSide) {
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
    const currentPosition = tokenPositions[0].netTraderPosition

    const currentPositionEth = Number(formatEther(currentPosition.abs()))

    let newMarginFraction: number = 0

    if (currentPosition.gte(0) && side == 'buy') {
      newMarginFraction = marketValueEth / (currentPositionEth + size)
    } else if (currentPosition.gte(0) && side == 'sell') {
      currentPositionEth - size == 0
        ? (newMarginFraction = Number.MAX_SAFE_INTEGER)
        : (newMarginFraction =
            marketValueEth / Math.abs(currentPositionEth - size))
    } else if (currentPosition.lte(0) && side == 'buy') {
      currentPositionEth - size == 0
        ? (newMarginFraction = Number.MAX_SAFE_INTEGER)
        : (newMarginFraction =
            marketValueEth / Math.abs(currentPositionEth - size))
    } else if (currentPosition.lte(0) && side == 'sell') {
      newMarginFraction = marketValueEth / (currentPositionEth + size)
    }

    return newMarginFraction
  }

  async updatePosition(size: number, side: OrderSide) {
    const amount =
      side == 'buy'
        ? parseEther(size.toString())
        : parseEther((-1 * size).toString())

    const oldMarginFraction = await this._currentMarginFraction()
    const newMarginFraction = await this._simulatePostTrade(size, side)

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

  async getRagePosition() {
    const { tokenPositions } = await (this.contracts
      .clearingHouse as ClearingHouse).getAccountInfo(this.ammConfig.ACCOUNT_ID)
    const priceX128 = await (this.contracts
      .clearingHouse as ClearingHouse).getVirtualTwapPriceX128(
      this.ammConfig.POOL_ID
    )
    const price = await priceX128ToPrice(priceX128, 6, 18)

    const position = tokenPositions[0].netTraderPosition

    return {
      eth: formatEther(position),
      notional: Number(formatEther(position)) * price,
    }
  }
}
