import { log } from '../../discord-logger'
import { FTX_CONFIG, PRE_FLIGHT_CHECK, STRATERGY_CONFIG } from '../../config'
import { AccountSummary, FuturesPosition, OrderSide, RestClient } from 'ftx-api'

// track avg position size

export default class Ftx {
  private marketId
  private ftxClient

  public takerFee: number

  public hasOpenPosition: boolean

  public currentFundingRate = 0 // weighted based on past 8 hours
  public netNotionalFundingPaid = 0

  constructor() {
    this.ftxClient = new RestClient(
      FTX_CONFIG.ACCESS_KEY,
      FTX_CONFIG.ACCESS_SECRET,
      {
        subAccountName: FTX_CONFIG.SUB_ACCOUNT_ID,
      }
    )

    this.hasOpenPosition = false

    this.takerFee = FTX_CONFIG.FEE
    this.marketId = FTX_CONFIG.MARKET_ID
  }

  async initialize() {
    await this._preFlightChecks()
    setInterval(async () => this._updateCurrentFundingRate(), 5 * 60 * 100)
  }

  private _scaleDown(size: number) {
    return size / FTX_CONFIG.SCALING_FACTOR
  }

  private _scaleUp(size: number) {
    return size * FTX_CONFIG.SCALING_FACTOR
  }

  // +ve => longs pays short
  async _updateCurrentFundingRate() {
    const now = Math.floor(new Date().getTime() / 1000)

    // const fundingPayment = await this.ftxClient.getFundingPayments({
    //   start_time: now - 8 * 60 * 60,
    //   end_time: now,
    //   future: this.marketId,
    // })

    const markets = (await this.ftxClient.getFundingRates()).result

    let first

    for (const each of markets) {
      if (each.future == 'ETH-PERP') {
        first = each.rate
        break
      }
    }

    console.log(first)

    const position = await this.queryFtxPosition()

    let netNotionalFunding = 0

    // for (const each of fundingPayment.result) {
    //   netNotionalFunding += each.payment
    // }

    this.netNotionalFundingPaid = netNotionalFunding

    position.cost == 0
      ? (this.currentFundingRate = 0)
      : (this.currentFundingRate = netNotionalFunding / position.cost)
  }

  async netProfit() {
    if (!this.hasOpenPosition) {
      return 0
    }

    const position = await this.ftxClient.getPositions(true)

    const netSize = position.result[0].netSize
    const avgOpenPrice = position.result[0].recentAverageOpenPrice!

    const currentPrice = await this.queryFtxPrice()

    const unrealizedPnl =
      netSize * (currentPrice - avgOpenPrice) - netSize * this.takerFee

    const scaled = this._scaleUp(unrealizedPnl)

    return scaled
  }

  async _preFlightChecks() {
    const [accountInfo, position] = await Promise.all([
      this.ftxClient.getAccount(),
      this.ftxClient.getPositions(true),
    ])

    if (
      accountInfo.result.marginFraction <
        STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD &&
      accountInfo.result.marginFraction !== null
    ) {
      await log(
        `insufficient ftx margin fraction, available: ${accountInfo.result.marginFraction},
        required: ${STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD}`,
        'ARB_BOT'
      )
      return // should just turn off and turn back on next interval
    }

    if (
      accountInfo.result.freeCollateral <
        PRE_FLIGHT_CHECK.FTX_BALANCE_THRESHOLD &&
      accountInfo.result.freeCollateral !== null
    ) {
      await log(
        `insufficient collateral balance on ftx, available: ${accountInfo.result.freeCollateral},
        required: ${PRE_FLIGHT_CHECK.FTX_BALANCE_THRESHOLD}`,
        'ARB_BOT'
      )
      return
    }

    if (position.result.length > 0) {
      this.hasOpenPosition = true
    }
  }

  async queryFtxPrice() {
    return ((await this.ftxClient.getFuture(this.marketId)) as any).result!
      .mark! as number
  }

  async queryFtxMargin() {
    const margin = (await this.ftxClient.getAccount()).result.totalAccountValue
    return this._scaleUp(margin)
  }

  async queryFtxPosition() {
    const margin = (await this.ftxClient.getPositions(true)).result[0]
    return margin
  }

  async queryFtxAccount() {
    const margin = (await this.ftxClient.getAccount()).result
    return margin
  }

  private async _simulatePostTrade(
    size: number,
    price: number,
    side: OrderSide,
    account: AccountSummary,
    position: FuturesPosition
  ) {
    const updatedCost =
      side === position.side
        ? position.cost + size * price
        : position.cost - size * price

    if (updatedCost === 0) {
      return {
        oldMarginFraction: account.marginFraction,
        newMarginFraction: Number.MAX_SAFE_INTEGER,
      }
    }

    const newMarginFraction = account.totalAccountValue / Math.abs(updatedCost)

    return {
      oldMarginFraction: account.marginFraction,
      newMarginFraction: newMarginFraction,
    }
  }

  async updatePosition(size: number) {
    const side: OrderSide = size >= 0 ? 'sell' : 'buy'
    size = Math.abs(size)
    const scaled = this._scaleDown(size)
    const price = await this.queryFtxPrice()
    const account = (await this.ftxClient.getAccount()).result

    const {
      oldMarginFraction,
      newMarginFraction,
    } = await this._simulatePostTrade(
      scaled,
      price,
      side,
      account,
      account.positions[0]
    )

    if (newMarginFraction < STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD) {
      await log(
        `add more margin to ftx, margin fraction below ${STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD}, 
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

    await this.ftxClient.placeOrder({
      size: scaled,
      side: side,
      price: null,
      type: 'market',
      market: this.marketId,
    })

    const updatedPosition = await this.ftxClient.getPositions(true)

    if (updatedPosition.result[0].netSize === 0) this.hasOpenPosition = false
    return updatedPosition
  }
}
