import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Deploy native ETH HTLC
  const HTLC = await ethers.getContractFactory("HTLC");
  const htlc = await HTLC.deploy();
  await htlc.waitForDeployment();
  const htlcAddr = await htlc.getAddress();
  console.log("HTLC (native):", htlcAddr);

  // Deploy ERC20 HTLC
  const HTLC_ERC20 = await ethers.getContractFactory("HTLC_ERC20");
  const htlcErc20 = await HTLC_ERC20.deploy();
  await htlcErc20.waitForDeployment();
  const erc20Addr = await htlcErc20.getAddress();
  console.log("HTLC_ERC20:", erc20Addr);

  console.log("\n--- Deployment Summary ---");
  console.log(`Network: ${(await ethers.provider.getNetwork()).name} (chainId: ${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`HTLC (native): ${htlcAddr}`);
  console.log(`HTLC_ERC20:    ${erc20Addr}`);
  console.log(`Owner:         ${deployer.address}`);
  console.log(`Fee:           1% (100 bps)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
