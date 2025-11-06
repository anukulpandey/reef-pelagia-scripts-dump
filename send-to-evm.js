import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import fetch from "node-fetch";

// ✅ Configuration
const WS_ENDPOINT = "ws://127.0.0.1:9944";
const EVM_RPC = "http://127.0.0.1:8545";

// Parse CLI args: --to 0x... --amount 10
const args = process.argv.slice(2);
const toIndex = args.indexOf("--to");
const amountIndex = args.indexOf("--amount");

if (toIndex === -1 || amountIndex === -1) {
  console.error("❌ Usage: node send_to_evm.js --to <EVM_ADDRESS> --amount <REEF_AMOUNT>");
  process.exit(1);
}

const TO_EVM = args[toIndex + 1];
const AMOUNT_REEF = parseFloat(args[amountIndex + 1]);
const AMOUNT_WEI = BigInt(Math.floor(AMOUNT_REEF * 1e18));

console.log(`🎯 Target EVM: ${TO_EVM}`);
console.log(`💰 Amount: ${AMOUNT_REEF} REEF (${AMOUNT_WEI} Wei)`);

// Helper to fetch balance from eth-rpc
async function ethGetBalance(evmHex) {
  const res = await fetch(EVM_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [evmHex, "latest"],
      id: 1,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return BigInt(data.result);
}

async function main() {
  console.log(`\n🔌 Connecting to ${WS_ENDPOINT} ...`);
  const provider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider });

  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");
  console.log(`✅ Connected to chain: ${(await api.rpc.system.chain()).toString()}`);
  console.log(`👤 Using sender: ${alice.address}`);

  // Claim default EVM account if not claimed
  const evmAddr = await api.query.evmAccounts.evmAddresses(alice.address);
  if (evmAddr.isEmpty) {
    console.log("\n🧩 Claiming Alice’s default EVM account...");
    await new Promise(async (resolve) => {
      const unsub = await api.tx.evmAccounts
        .claimDefaultAccount()
        .signAndSend(alice, ({ status }) => {
          if (status.isFinalized) {
            unsub();
            resolve();
          }
        });
    });
  }

  const mappedEvm = (await api.query.evmAccounts.evmAddresses(alice.address)).toString();
  console.log(`🔗 Alice’s mapped EVM: ${mappedEvm}`);

  // 📊 Fetch balances before
  const nativeBefore = (await api.query.system.account(alice.address)).data.free.toBigInt();
  const evmBefore = await ethGetBalance(TO_EVM);

  console.log("\n📊 Balances Before Transaction:");
  console.table([
    { Type: "Before TX", Native_REEF: Number(nativeBefore) / 1e18, Target_EVM_REEF: Number(evmBefore) / 1e18 },
  ]);

  // Check revive.transfer signature
  const argsMeta = api.tx.revive.transfer.meta.toJSON().args || [];
  const names = argsMeta.map((a) => (a?.name || "").toLowerCase());
  const types = argsMeta.map((a) => (a?.type?.info ? a.type.info : a?.type || "").toLowerCase());
  const has = (s) => names.join(",").includes(s) || types.join(",").includes(s);

  async function sendAndWait(tx) {
    return new Promise(async (resolve) => {
      const unsub = await tx.signAndSend(alice, ({ status, events, dispatchError }) => {
        if (status.isInBlock) console.log(`📦 Included: ${status.asInBlock}`);
        if (status.isFinalized) {
          console.log(`✅ Finalized: ${status.asFinalized}`);
          if (dispatchError) console.log("❌ Dispatch Error:", dispatchError.toHuman());
          events.forEach(({ event }) => console.log("📢", event.toHuman()));
          unsub();
          resolve();
        }
      });
    });
  }

  // 🚀 Execute transfer
  console.log("\n💸 Executing transfer to target EVM address...");

  try {
    let tx;
    if (argsMeta.length === 2 && has("h160")) {
      tx = api.tx.revive.transfer(TO_EVM, AMOUNT_WEI);
    } else if (argsMeta.length === 3 && has("accountid") && has("h160")) {
      tx = api.tx.revive.transfer(alice.address, TO_EVM, AMOUNT_WEI);
    } else {
      console.log("⚠️ Unknown revive.transfer signature; trying (H160, Amount) fallback...");
      tx = api.tx.revive.transfer(TO_EVM, AMOUNT_WEI);
    }

    await sendAndWait(tx);
  } catch (err) {
    console.error("❌ revive.transfer failed:", err.message);
  }

  // 📊 Fetch balances after
  const nativeAfter = (await api.query.system.account(alice.address)).data.free.toBigInt();
  const evmAfter = await ethGetBalance(TO_EVM);

  console.log("\n📊 Balance Comparison:");
  console.table([
    {
      Type: "Before TX",
      Native_REEF: Number(nativeBefore) / 1e18,
      Target_EVM_REEF: Number(evmBefore) / 1e18,
    },
    {
      Type: "After TX",
      Native_REEF: Number(nativeAfter) / 1e18,
      Target_EVM_REEF: Number(evmAfter) / 1e18,
    },
  ]);

  if (Number(evmAfter) === Number(evmBefore)) {
    console.log("⚠️ EVM balance unchanged — check if revive.transfer moves native → EVM.");
  }

  await api.disconnect();
  console.log("\n🔌 Disconnected.");
}

main().catch((e) => console.error("❌ Error:", e));
