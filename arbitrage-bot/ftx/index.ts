import { log } from '../../discord-logger'
import { FTX_CONFIG, PRE_FLIGHT_CHECK, STRATERGY_CONFIG } from '../../config'
import { AccountSummary, FuturesPosition, OrderSide, RestClient } from 'ftx-api'

export default class Ftx {
  private marketId
  private ftxClient

  public takerFee: number

  public hasOpenPosition: boolean

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
  }

  private _scaleDown(size: number) {
    return size / FTX_CONFIG.SCALING_FACTOR
  }

  private _scaleUp(size: number) {
    return size * FTX_CONFIG.SCALING_FACTOR
  }

  private async _estimateFundingFees(netSize: number, price: number) {
    const now = Math.floor(new Date().getTime() / 1000)

    const fundingPayment = await this.ftxClient.getFundingPayments({
      start_time: now - 3600,
      end_time: now,
      future: this.marketId,
    })

    const totalFp = fundingPayment.result[0].rate * netSize * price

    return totalFp
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
      netSize * (currentPrice - avgOpenPrice) -
      netSize * this.takerFee -
      (await this._estimateFundingFees(netSize, currentPrice))

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

      throw new Error('pre flight check failed: insufficient margin ratio')
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

      throw new Error('pre flight check failed: insufficient free collateral')
    }

    if (position.result.length > 0) {
      this.hasOpenPosition = true
    }
  }

  async queryFtxPrice() {
    return ((await this.ftxClient.getFuture(this.marketId)) as any).result!
      .mark!
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

  async updatePosition(size: number, side: OrderSide) {
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
