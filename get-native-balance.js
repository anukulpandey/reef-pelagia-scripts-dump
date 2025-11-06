// getBalance.js
import { ApiPromise, WsProvider } from "@polkadot/api";

const WS_ENDPOINT = "ws://127.0.0.1:9944"; // Local Substrate node

// Replace with any Substrate SS58 address (Alice in this example)
const ADDRESS = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

async function main() {
  try {
    console.log(`🔌 Connecting to ${WS_ENDPOINT} ...`);
    const provider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider });

    console.log(`✅ Connected to chain: ${(await api.rpc.system.chain()).toString()}`);

    // Query account balance
    const { data: balance } = await api.query.system.account(ADDRESS);

    console.log(`\n💰 Account: ${ADDRESS}`);
    console.log(`Free balance: ${balance.free.toHuman()}`);
    console.log(`Reserved balance: ${balance.reserved.toHuman()}`);

    await api.disconnect();
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

main();
