import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import fetch from "node-fetch";

const WS_ENDPOINT = "ws://127.0.0.1:9944";
const EVM_RPC = "http://127.0.0.1:8545";
const AMOUNT_WEI = 10_000_000_000_000_000_000n; // 10 REEF

// 🔹 Helper to query EVM balance from eth-rpc
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
  console.log(`🔌 Connecting to ${WS_ENDPOINT} ...`);
  const api = await ApiPromise.create({ provider: new WsProvider(WS_ENDPOINT) });

  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");
  console.log(`✅ Connected to chain: ${(await api.rpc.system.chain()).toString()}`);
  console.log(`👤 Substrate: ${alice.address}`);

  // Ensure EVM account is claimed
  console.log("\n🧩 Ensuring default EVM account is claimed for Alice...");
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

  const evmAddr = await api.query.evmAccounts.evmAddresses(alice.address);
  const evmHex = evmAddr?.toString();
  console.log(`🔗 Claimed EVM Address: ${evmHex || "None"}`);
  if (!evmHex) {
    console.log("⚠️ No EVM address mapped; aborting.");
    await api.disconnect();
    return;
  }

  // 📊 Fetch native + EVM balances before
  const nativeBefore = (await api.query.system.account(alice.address)).data.free.toBigInt();
  const evmBefore = await ethGetBalance(evmHex);

  console.table([
    {
      Type: "Before TX",
      Native_REEF: Number(nativeBefore) / 1e18,
      EVM_REEF: Number(evmBefore) / 1e18,
    },
  ]);

  // Inspect revive.transfer args
  const transferMeta = api.tx.revive.transfer.meta.toJSON();
  const args = transferMeta.args || [];
  console.log("\n🧪 revive.transfer signature args:");
  console.log(args);

  const argTypes = args.map((a) =>
    (a?.type?.info ? a.type.info : a?.type || "").toString().toLowerCase()
  );
  const argNames = args.map((a) => (a?.name || "").toString().toLowerCase());
  const lowerHas = (s) => argTypes.join(",").includes(s) || argNames.join(",").includes(s);

  async function sendAndWait(tx) {
    return new Promise(async (resolve) => {
      const unsub = await tx.signAndSend(alice, ({ status, events, dispatchError }) => {
        if (status.isInBlock) console.log(`📦 Included: ${status.asInBlock}`);
        if (status.isFinalized) {
          console.log(`✅ Finalized: ${status.asFinalized}`);
          if (dispatchError) {
            console.log("❌ Dispatch Error:", dispatchError.toHuman());
          }
          events.forEach(({ event }) => console.log("📢", event.toHuman()));
          unsub();
          resolve();
        }
      });
    });
  }

  let funded = false;
  try {
    if (args.length === 2 && (lowerHas("h160") || lowerHas("h-160"))) {
      console.log("\n➡️ Calling revive.transfer(H160, Amount) ...");
      const tx = api.tx.revive.transfer(evmHex, AMOUNT_WEI);
      await sendAndWait(tx);
      funded = true;
    } else if (args.length === 3 && lowerHas("accountid") && lowerHas("h160")) {
      console.log("\n➡️ Calling revive.transfer(AccountId, H160, Amount) ...");
      const tx = api.tx.revive.transfer(alice.address, evmHex, AMOUNT_WEI);
      await sendAndWait(tx);
      funded = true;
    } else if (args.length === 2 && lowerHas("accountid") && !lowerHas("h160")) {
      console.log("\n⚠️ revive.transfer looks like native AccountId transfer; skipping.");
    } else {
      console.log("\n⚠️ Unknown signature; trying revive.transfer(H160, Amount) optimistically...");
      const tx = api.tx.revive.transfer(evmHex, AMOUNT_WEI);
      await sendAndWait(tx);
      funded = true;
    }
  } catch (err) {
    console.error("❌ revive.transfer failed:", err.message);
  }

  // 📊 Fetch native + EVM balances after
  const nativeAfter = (await api.query.system.account(alice.address)).data.free.toBigInt();
  const evmAfter = await ethGetBalance(evmHex);

  console.log("\n📊 Balance Comparison:");
  console.table([
    {
      Type: "Before TX",
      Native_REEF: Number(nativeBefore) / 1e18,
      EVM_REEF: Number(evmBefore) / 1e18,
    },
    {
      Type: "After TX",
      Native_REEF: Number(nativeAfter) / 1e18,
      EVM_REEF: Number(evmAfter) / 1e18,
    },
  ]);

  if (funded && evmAfter === evmBefore) {
    console.log(
      "⚠️ Transfer executed but EVM balance unchanged. This runtime may not actually move native → EVM."
    );
  }

  await api.disconnect();
  console.log("\n🔌 Disconnected.");
}

main().catch((e) => {
  console.error("❌ Error:", e);
});
