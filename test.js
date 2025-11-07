import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import fetch from "node-fetch";
import { keccakAsHex } from "@polkadot/util-crypto";
import { ethers } from "ethers";

const WS_ENDPOINT = "ws://127.0.0.1:9944";
const REST_RPC = "http://127.0.0.1:9944";
const EVM_RPC = "http://34.123.142.246:8545/";

// Reef ERC20 precompile address
const REEF_ERC20_CONTRACT = "0x0000000000000000000000000000000001000000";

// ---- ERC20 interface ----
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)"
];


async function main() {
  console.log(`\n🔌 Connecting to ${WS_ENDPOINT} ...`);
  const provider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider });

  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");

  console.log(`✅ Connected to chain: ${(await api.rpc.system.chain()).toString()}`);
  console.log(`👤 Native address: ${alice.address}`);

  // 2️⃣ Derive EVM address
  const pubKey = alice.publicKey;
  const evmHex = "0x" + keccakAsHex(pubKey).slice(26);
  console.log(`🔗 Derived EVM Address: ${evmHex}`);
  const evmProvider = new ethers.JsonRpcProvider(EVM_RPC);
  const reefContract = new ethers.Contract(REEF_ERC20_CONTRACT, ERC20_ABI, evmProvider);
  const evmBalanceOf = await reefContract.balanceOf(evmHex);
//   console.log(`💰 ERC20.balanceOf(${evmHex}) = ${ethers.formatEther(evmBalanceOf)} REEF`);

  // 5️⃣ Fetch native and EVM (raw) balances for comparison
  const { data: nativeBalStruct } = await api.query.system.account(alice.address);
  const nativeBalance = nativeBalStruct.free.toBigInt();

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

  const evmBalanceRaw = await getEvmBalance(evmHex);

  console.log("\n📊 Address & Balance Summary:");
  console.table([
    {
      Type: "Native/Substrate",
      Address: alice.address,
      Balance_REEF: Number(nativeBalance) / 1e18,
    },
    {
      Type: "EVM (Precompile ERC20)",
      Address: evmHex,
      Balance_REEF: Number(evmBalanceOf) / 1e18,
    },
    {
      Type: "EVM (Raw eth_getBalance)",
      Address: evmHex,
      Balance_REEF: Number(evmBalanceRaw) / 1e18,
    },
  ]);

  await api.disconnect();
  console.log("🔌 Disconnected.");
}

main().catch((e) => console.error("❌ Error:", e));
