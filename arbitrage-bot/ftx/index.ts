import { log } from '../../discord-logger'
import {
  FTX_CONFIG,
  BOT_WATCHER_ROLE,
  PRE_FLIGHT_CHECK,
  STRATERGY_CONFIG,
} from '../../config-env'
import { AccountSummary, FuturesPosition, OrderSide, RestClient } from 'ftx-api'
import { InitOptions } from '../../types'

export default class Ftx {
  private marketId
  private ftxClient

  public takerFee: number

  public hasOpenPosition: boolean

  public currentFundingRate = 0

  constructor(initOptions: InitOptions) {
    initOptions.isPriceArb === true
      ? (this.ftxClient = new RestClient(
          FTX_CONFIG.PRICE_ARB_ACCOUNT.ACCESS_KEY,
          FTX_CONFIG.PRICE_ARB_ACCOUNT.ACCESS_SECRET,
          {
            subAccountName: FTX_CONFIG.PRICE_ARB_ACCOUNT.SUB_ACCOUNT_ID,
          }
        ))
      : (this.ftxClient = new RestClient(
          FTX_CONFIG.FUNDING_ARB_ACCOUNT.ACCESS_KEY,
          FTX_CONFIG.FUNDING_ARB_ACCOUNT.ACCESS_SECRET,
          {
            subAccountName: FTX_CONFIG.FUNDING_ARB_ACCOUNT.SUB_ACCOUNT_ID,
          }
        ))

    this.hasOpenPosition = false

    this.takerFee = FTX_CONFIG.FEE
    this.marketId = FTX_CONFIG.MARKET_ID
  }

  async initialize() {
    await this._preFlightChecks()
    setInterval(async () => {
      this.currentFundingRate = await this.getCurrentFundingRate()
    }, 5 * 60 * 100)
  }

  private _scaleDown(size: number) {
    return size / FTX_CONFIG.SCALING_FACTOR
  }

  private _scaleUp(size: number) {
    return size * FTX_CONFIG.SCALING_FACTOR
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
        `${BOT_WATCHER_ROLE} insufficient ftx margin fraction, available: ${accountInfo.result.marginFraction},
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
        `${BOT_WATCHER_ROLE} insufficient collateral balance on ftx, available: ${accountInfo.result.freeCollateral},
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
    let updatedCost: number

    if (!position) {
      updatedCost = size * price
    } else {
      updatedCost =
        side === position.side
          ? position.cost + size * price
          : position.cost - size * price
    }

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
        `${BOT_WATCHER_ROLE} add more margin to ftx, margin fraction below ${STRATERGY_CONFIG.SOFT_MARGIN_RATIO_THRESHOLD}, 
        margin fraction before: ${oldMarginFraction},
        margin fraction after current trade: ${newMarginFraction}
        `,
        'ARB_BOT'
      )
    }

    if (newMarginFraction < STRATERGY_CONFIG.HARD_MARGIN_RATIO_THRESHOLD) {
      await log(
        `${BOT_WATCHER_ROLE} FTX: cannot take further position due to breach of max allowed margin fraction,
        margin fraction before: ${oldMarginFraction},
        margin fraction after current trade: ${newMarginFraction}     
        `,
        'ARB_BOT'
      )
      throw new Error(
        'FTX: cannot take further position due to breach of max allowed margin fraction'
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

  async getTotalTrades(from: number, to: number) {
    return (
      await this.ftxClient.getOrderHistory({
        end_time: to,
        start_time: from,
        market: this.marketId,
      })
    ).result.length
  }

  async getCurrentFundingRate() {
    return (
      (
        await this.ftxClient.getFundingRates({
          future: this.marketId,
        })
      ).result[0].rate * 100
    )
  }
}
