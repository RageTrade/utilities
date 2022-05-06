import { BigNumber } from 'ethers'
import { log } from '../../discord-logger'
import { OrderSide, RestClient } from 'ftx-api'
import { FTX_CONFIG, PRE_FLIGHT_CHECK } from '../../config'

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
    this.marketId = FTX_CONFIG.MARKET_ID
  }

  private _scaleDown(size: number) {
    return size / FTX_CONFIG.SCALING_FACTOR
  }

  private _scaleUp(size: number) {
    return size * FTX_CONFIG.SCALING_FACTOR
  }

  async _estimateFees(size: number, price: number): Promise<number> {
    const now = Math.floor((new Date()).getTime() / 1000)

    const fundingPayment = await this.ftxClient.getFundingPayments({
      start_time: now - 3600,
      end_time: now,
      future: this.marketId
    })

    return (fundingPayment.result[0].rate * size * price) + (this.takerFee * size * price)
  }

  async closePosition() {
    const position = await this.ftxClient.getPositions(true)
    const side: OrderSide = position.result[0].side === 'buy' ? 'sell' : 'buy'

    await this.ftxClient.placeOrder({
      size: position.result[0].size,
      side: side,
      price: null,
      type: 'market',
      market: this.marketId,
    })

    this.hasOpenPosition = false
  }

  async _netProfit() {
    // if (!this.hasOpenPosition) {
    //   return 0
    // }

    // open position size * ( current price - avgOpenPrice )

    // while (true) {
    //   const position = await this.ftxClient.getPositions(true)
    //   const scaled = this._scaleUp(position.result[0].unrealizedPnl)

    //   const currentPrice = await this.queryFtxPrice()

    //   console.log(position)

    //   // console.log('currentPrice', currentPrice)
    //   // console.log('netSize', position.result[0].netSize)
    //   // console.log('entryPrice', position.result[0].entryPrice!)
    //   // console.log('recentAverageOpenPrice', position.result[0].recentAverageOpenPrice!)

    //   // console.log(position.result[0].netSize * (currentPrice - position.result[0].recentAverageOpenPrice!))
    // }
    
    // const past = await this.ftxClient.getFuture()


    // return scaled - await this._estimateFees(position.result[0].netSize, position.result[0].entryPrice!);
  }

  async _preFlightChecks() {
    const [accountInfo, position] = await Promise.all([
      this.ftxClient.getAccount(),
      this.ftxClient.getPositions(true),
    ])

    if (
      accountInfo.result.marginFraction <
      PRE_FLIGHT_CHECK.FTX_MARGIN_RATIO_THRESHOLD
    ) {
      console.log(
        `insufficient ftx margin fraction, available: ${accountInfo.result.marginFraction},
        required: ${PRE_FLIGHT_CHECK.FTX_MARGIN_RATIO_THRESHOLD}`,
        'ARB_BOT'
      )
    }

    if (
      accountInfo.result.freeCollateral < PRE_FLIGHT_CHECK.FTX_BALANCE_THRESHOLD
    ) {
      console.log(
        `insufficient collateral balance on ftx, available: ${accountInfo.result.freeCollateral},
        required: ${PRE_FLIGHT_CHECK.FTX_BALANCE_THRESHOLD}`,
        'ARB_BOT'
      )
    }

    if (position.result.length > 0) {
      this.hasOpenPosition = true
    }

    this.takerFee = (await this.ftxClient.getAccount()).result.takerFee
  }

  async queryFtxPrice() {
    return (await this.ftxClient.getFuture(this.marketId) as any).result!.mark!
  }


  async updatePosition(size: number, side: OrderSide) {
    const out = await this.ftxClient.placeOrder({
      size: size, //todo; add back scaling
      side: side,
      price: null,
      type: 'market',
      market: this.marketId,
    })

    console.log(await this.ftxClient.getPositions(true))

  }
}
