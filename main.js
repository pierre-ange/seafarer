import * as dotenv from 'dotenv';
import * as config from './config.js';
import { Seafarer } from './seafarer.js'
dotenv.config();

const args = {network: "main", contractName: "supducks", pwd: process.env.pwd};
// const args = {network: "rinkeby", contractName: "foxfam", pwd: ""};

const contract = config.contracts[args.network][args.contractName];
let app = new Seafarer()
await app.initWeb3({network: args.network, pwd: args.pwd})
await app.setContract(contract);
console.log("Done!");
