import Web3 from 'web3';
import BigNumber from 'bignumber.js';

export const toWei = Web3.utils.toWei;
export const fromWei = Web3.utils.fromWei;
// From Number of Eth to BigNumber Wei
export const toBNWei = (x) => BigNumber(toWei(String(x), "ether"));
// From BigNumber Wei to Number of ETH
export const fromBNWei = (bn) => Number(fromWei(bn.toString()));

export const encryptPK = function(pk, password){
    var web3 = new Web3(new Web3.providers.HttpProvider('https://mainnet.infura.io'));
    let encrypted = web3.eth.accounts.encrypt(pk, password);
    return(JSON.stringify(encrypted));
}