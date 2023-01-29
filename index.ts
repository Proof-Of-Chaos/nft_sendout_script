import "@polkadot/api-augment";
import dotenv from "dotenv";
import { generateCalls } from "./src/generateCalls.js";
import { BN } from '@polkadot/util';

dotenv.config();

async function main() {
  generateCalls(new BN(54))
}

main();

