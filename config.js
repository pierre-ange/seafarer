const dftMargin = 0.1; // Our default profit margin (SellPrice-BuyPrice)/BuyPrice. 0.1 -> 10%.
export const buffer = 0.002; // Amount in ETH to be added on top of the highest bid.

export const contracts = {
    main: {
        supducks: {
            address: "0x3fe1a4c1481c8351e91b64d5c398b159de07cbc5",
            strategy: {resellPrice: 1.06, margin: 0.1}
        }
    }, 
    rinkeby: {
        foxfam: {
            address: "0xa234c5a67d62c965d5f9380ad22255338c223e06",
            strategy: {resellPrice: 0.1, margin: dftMargin}
        }
    }
}

export const WETHTokenAddress = {
    main: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    rinkeby: "0xc778417E063141139Fce010982780140Aa0cD5Ab"
}