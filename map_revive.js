import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import fetch from "node-fetch";
import { keccakAsHex } from "@polkadot/util-crypto";

const WS_ENDPOINT = "ws://127.0.0.1:9944";
const REST_RPC = "http://127.0.0.1:9944"; // for curl-like POSTs to substrate
const EVM_RPC = "http://127.0.0.1:8545"; // for eth-rpc queries

// ---- helper: call substrate RPC via HTTP ----
async function substrateRpc(method, params = []) {
  const res = await fetch(REST_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

// ---- helper: fetch native balance via RPC ----
async function getNativeBalance(address) {
  const result = await substrateRpc("state_getStorage", [
    // storage key for system.account(AccountId)
    // we’ll use runtime API instead through @polkadot/api to simplify
  ]);
  return result;
}

// ---- helper: fetch EVM balance ----
async function getEvmBalance(evmAddr) {
  const res = await fetch(EVM_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [evmAddr, "latest"],
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
  console.log(`👤 Native address: ${alice.address}`);

  // 1️⃣ Map the account in revive pallet
  console.log("\n🧩 Mapping account using revive.mapAccount() ...");
  await new Promise(async (resolve) => {
    const unsub = await api.tx.revive.mapAccount().signAndSend(alice, ({ status, events, dispatchError }) => {
      if (status.isFinalized) {
        console.log(`✅ Finalized in block: ${status.asFinalized}`);
        if (dispatchError) {
          console.log("❌ Dispatch Error:", dispatchError.toHuman());
        }
        unsub();
        resolve();
      }
    });
  });

  // 2️⃣ Derive EVM address (same formula as pallet)
  const pubKey = alice.publicKey;
  const evmHex = "0x" + keccakAsHex(pubKey).slice(26);
  console.log(`🔗 Derived EVM Address: ${evmHex}`);

  // 3️⃣ Fetch native balance (via @polkadot/api and curl-like call)
  const { data: nativeBalStruct } = await api.query.system.account(alice.address);
  const nativeBalance = nativeBalStruct.free.toBigInt();

  const curlNative = await fetch(REST_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "system_accountNextIndex",
      params: [alice.address],
    }),
  });
  const nativeCurlResult = await curlNative.json();

  // 4️⃣ Fetch EVM balance via eth-rpc
  const evmBalance = await getEvmBalance(evmHex);

  // 5️⃣ Fetch reverse mapping (EVM → Substrate)
  const reverseMapping = await api.query.revive.originalAccount(evmHex);
  const mappedNative = reverseMapping.isEmpty ? "❌ None" : reverseMapping.toHuman();

  // 6️⃣ Print all results in table form
  console.log("\n📊 Address & Balance Summary:");
  console.table([
    {
      Type: "Native/Substrate",
      Address: alice.address,
      Balance_REEF: Number(nativeBalance) / 1e18,
    },
    {
      Type: "EVM (Derived)",
      Address: evmHex,
      Balance_REEF: Number(evmBalance) / 1e18,
    },
  ]);

  console.log("\n🔁 Reverse Mapping Check:");
  console.table([{ "EVM Address": evmHex, "Mapped Native Account": mappedNative }]);

  console.log("\n🧾 (From curl-like JSON-RPC query)");
  console.log(nativeCurlResult);

  await api.disconnect();
  console.log("🔌 Disconnected.");
}

main().catch((e) => console.error("❌ Error:", e));
