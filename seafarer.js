import Accounts from 'web3-eth-accounts';
import BigNumber from 'bignumber.js';
import HDWalletProvider from '@truffle/hdwallet-provider';
import { OpenSeaPort } from 'opensea-js';
import { RateLimiter } from 'limiter';
import { fromBNWei, toBNWei } from './utils.js';
import { WETHTokenAddress } from './config.js';
BigNumber.set({DECIMAL_PLACES: 0})


export class Seafarer {

    /* Initialize all attributes to null */
    constructor(){
        this.bidder = null;     // String. Bidding address.
        this.contract = null;   // Object. {address: <str:address>, fee?: <fee>, strategy: {resellPrice: <resellPrice>, margin: <margin>, maxBid: <maxBid>}}
        this.seaport = null;
        this.limiter = new RateLimiter({ tokensPerInterval: 1, interval: 5000 }); // 1 request/second max
    }
    
    /**
    * Initialize bidding address from EPK & pwd
    * Initialize seaport object on the network `networkName`
    * @param network rinkeby || main
    * @param pwd
    * The following environment variables must be defined: EPK, INFURA_URL
    */
    async initWeb3({network, pwd}){
        let account = new Accounts().decrypt(process.env.EPK, pwd)
        let provider = new HDWalletProvider({
            privateKeys: [account.privateKey],
            providerOrUrl: JSON.parse(process.env.INFURA_URL)[network]
        });

        this.seaport = new OpenSeaPort(provider, 
            {
                networkName: network,
                // apiKey: process.env.OPENSEA_API_KEY
            });

        this.bidder = provider.getAddress();
        console.log("Bidder: " + this.bidder);

        const WETHBalance = await this.seaport.getTokenBalance({
            accountAddress: this.bidder, 
            tokenAddress: WETHTokenAddress[network]
        })
        console.log("Bidder WETH Balance: " + fromBNWei(WETHBalance) + " WETH");

        // TODO - get list of token ids with bids on. These will be excluded from further bids.
    }

    /**
    * Store contract as attribute to seafarer, after some checks.
    * Calculate and store maxBid based on expected margin
    * @param contract {address: <address>, fee?: <fee>, strategy: {resellPrice: <resellPrice>, margin: <margin>}}
    */
    async setContract(contract){
        let _contract = { ... contract };
        if(
            (_contract.address == null) || 
            (_contract.strategy.margin === null)
        ){throw "Contract not properly configured";}
        
        // Get contract info from seaport
        const asset = await this.seaport.api.getAsset({tokenAddress: _contract.address, tokenId: 0});
        console.log(`Collection Name: ${asset.assetContract.name}; Slug=${asset.collection.slug}`);

        // Check fees - throw if unexpectedly high or if buyer fees.
        let fee = BigNumber(asset.assetContract.sellerFeeBasisPoints / 1e4);
        console.log(`Collection Fee: ${fee.times(100).toString()}%`);
        if(asset.assetContract.buyerFeeBasisPoints != 0)
            throw "NotImplementedError: Non-zero buyer fee."
        if(fee.isGreaterThanOrEqualTo(0.1))
            throw "ValueError: Fee greater than 10%. Check the contract on OpenSea."
        
        // Get collection floor price. If resell price not provided, set it to floor price
        let stats = await this.getCollectionStats(asset.collection.slug);
        let floorPrice = stats.floor_price;
        console.log(`Expected Resell Price: ${_contract.strategy.resellPrice == null ? 'Not set' : String(_contract.strategy.resellPrice) + ' ETH'}`)
        console.log(`Collection Floor Price: ${floorPrice} ETH`);
        if(_contract.strategy.resellPrice == null){
            console.log(`Setting Expected Resell Price to Floor Price ${floorPrice} ETH`)
            _contract.strategy.resellPrice = floorPrice;
        }

        // Convert attributes to BigNumbers
        _contract.strategy.resellPrice = toBNWei(_contract.strategy.resellPrice);
        _contract.fee = fee;
        
        // Calculate strategy maxBid
        _contract.strategy.maxBid = this.calcMaxBid({
            fee: _contract.fee,
            resellPrice: _contract.strategy.resellPrice,
            margin: _contract.strategy.margin
        })
        console.log(`Setting maxBid to ${fromBNWei(_contract.strategy.maxBid)} ETH (${_contract.strategy.margin * 100}% profit from resell at ${fromBNWei(_contract.strategy.resellPrice)} ETH)`)

        // Store to contract attribute
        this.contract = _contract;
    }

    /**
    * Max bid we can offer based on the expected resell price and our margin
    * maxBid = ResellPrice * (1 - sellerFee) / (1 + margin)
    * @param tokenAddress Address of the asset's contract
    * @param resellPrice BigNumber, in wei. Expected resell price in WETH (usually the collection floor price)
    * @param margin Our profit margin (SellPrice-BuyPrice)/BuyPrice. 0.1 -> 10%.
    */
    calcMaxBid({resellPrice, fee, margin}){
        let maxBid = BigNumber(1).minus(fee).times(resellPrice).div(BigNumber(1).plus(margin));
        maxBid = maxBid.div(1e14).times(1e14); // Round it to 4 decimal places
        console.log(`Collection Max Bid: ${fromBNWei(maxBid)} ETH`);
        return maxBid;
    }
    
    setMaxBid(maxBid){
        this.contract.strategy.maxBid = toBNWei(maxBid);
        console.log(`Collection Max Bid: ${fromBNWei(maxBid)} ETH`);
        return maxBid;
    }

    async getCollectionStats(slug){
        let stats = await this.seaport.api.get(`/collection/${slug}/stats`);
        return stats.stats;
    }

    // async getOwnOrders(){
    //     let orders = await this.seaport.api.getOrders({
    //         asset_contract_address: this.contract.address,
    //         include_bundled: false,
    //         side: 0, // Buy orders
    //         maker: this.bidder,
    //         limit: 50,
    //         offset: 0
    //     });
    //     return orders;
    // }

    /**
    * Get assets (max 10000)
    * Only 50 assets can be retrieved in one query to OpenSea API. 
    * This method makes as many queries as necessary to retrieve `n` assets.
    * @param n Number of assets to fetch
    */
    async getAssets(n){
        let MAX = 10000;
        if(n > MAX)
            throw `Too many assets: ${n}. Max is ${MAX}`;

        const LIMIT = 50;
        const nQries = Math.ceil(n / LIMIT);
        let res = []
        for (let i = 0; i < nQries; i++) {
            const _ = await this.limiter.removeTokens(1);
            console.log(`getAssets ${i}/${nQries-1}`)
            let { assets } = await this.seaport.api.getAssets({
                asset_contract_address: this.contract.address, 
                limit: i == nQries - 1 ? (n == LIMIT ? n : n % LIMIT) : LIMIT,
                offset: i * 50
            });
            res.push(...assets);
          }
        return res
    }

    /**
    * Get assets on sale, sorted by ascending sale price.
    * @param n Number of assets to fetch
    * @param maxSalePrice In units of WETH. Only assets on sale for below this value are returned.
    */
    async getAssetsOnSaleBelowPrice({n, maxSalePrice}){
        // Get all assets
        let assets = await this.getAssets(n);

        // Filter assets on sale
        let onSale = assets.filter((a) => a.sellOrders != null);

        // Keep fixed price sales only
        onSale = onSale.filter((a) => a.sellOrders[0].saleKind === 0)

        // Filter out assets whose sale price is above maxSalePrice
        if (maxSalePrice != null){
            onSale = onSale.filter((a) => a.sellOrders[0].currentPrice.lte(toBNWei(maxSalePrice)));
        }

        // Sort by ascending sale price
        onSale.sort((a, b) => a.sellOrders[0].currentPrice.minus(b.sellOrders[0].currentPrice));
        return onSale;
    }

    /**
    * Create buy order on token ID from collection defined at `this.contract.address` 
    * Throw an error if bid is negative or greater than `this.maxBid`.
    * @param bid    Value of the offer, in units of WETH. 0.1 = 0.1 WETH
    * @param tokenId Token ID
    * @param expirationSecs Number of seconds before the buy order expires
    * @param dryRun true to mimick the creation of a buy order, false to do it. Default true.
    */
    async createBuyOrder({bid, tokenId, expirationSecs, dryRun}){
        let _dryRun = dryRun == null ? true : dryRun;

        // Coerce bid to unit of WETH as a regular number
        let _bid = bid instanceof BigNumber ? fromBNWei(bid) : bid;
        let _maxBid = fromBNWei(this.contract.strategy.maxBid);

        // Make sure bid is within bounds
        if (_bid <= 0 || bid > _maxBid)
            throw `Unexpected Bid=${_bid}: must be > 0 and <= ${_maxBid}`;

        // Bid if not a dry run
        if(!_dryRun){
            const _ = await this.limiter.removeTokens(1);
            console.log(`Bidding tokenId: ${tokenId} at ${bid} WETH for ${expirationSecs} seconds.`)
            let buyOrder = await this.seaport.createBuyOrder({ 
                asset: {tokenId: tokenId, tokenAddress: this.contract.address}, 
                accountAddress: this.bidder, 
                startAmount: _bid, 
                expirationTime: Math.round(Date.now() / 1000 + expirationSecs),
            });
            return buyOrder;
        } else {
            console.log(`${_dryRun? 'Dry run - ': ''}Bidding tokenId: ${tokenId} at ${bid} WETH for ${expirationSecs} seconds.`)
        }
        return null;
    }

    /**
    * Create buy order on token ID from collection defined at `this.contract.address` 
    * Throw an error if bid is negative or greater than `this.maxBid`.
    * @param bid    Value of the offer, in units of WETH. 0.1 = 0.1 WETH
    * @param tokenId Token ID
    * @param expirationSecs Number of seconds before the buy order expires
    * @param dryRun true to mimick the creation of a buy order, false to do it. Default true.
    */
    async placeBids({n, maxSalePrice, expirationSecs, dryRun}){
        let _dryRun = dryRun == null ? true : dryRun;
        let _maxBid = fromBNWei(this.contract.strategy.maxBid);
        let assets = await this.getAssetsOnSaleBelowPrice({n, maxSalePrice});
        let bid = 0;
        for (const a of assets){
            try {
                bid = _maxBid;
                if(String(a.tokenId) == "9953"){
                    console.log(`Skipping ${a.tokenId}`);
                } else {
                    await this.createBuyOrder({
                        bid: bid, 
                        tokenId: a.tokenId, 
                        expirationSecs: expirationSecs, 
                        dryRun: _dryRun
                    });
                }
            }
            catch(e) {
                console.log(`Error with ${a.tokenId}. Skipping. Details: ${e}.`)
            }
        }
    }

    /**
    * Create buy order on token ID from collection defined at `this.contract.address` 
    * Throw an error if bid is negative or greater than `this.maxBid`.
    * @param bid    Value of the offer, in units of WETH. 0.1 = 0.1 WETH
    * @param tokenId Token ID
    * @param expirationSecs Number of seconds before the buy order expires
    * @param dryRun true to mimick the creation of a buy order, false to do it. Default true.
    */
     async placeBid({bid, tokenId, expirationSecs}){
        try {
            await this.createBuyOrder({
                bid: bid, 
                tokenId: String(tokenId), 
                expirationSecs: expirationSecs, 
                dryRun: false
            });
        }
        catch(e) {
            console.log(`Error with ${tokenId}. Details: ${e}.`)
        }
    }
}