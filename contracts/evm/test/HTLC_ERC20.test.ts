import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HTLC_ERC20 } from "../typechain-types";

// Minimal ERC20 for testing
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
];

describe("HTLC_ERC20 (Token Swaps)", function () {
  let htlc: HTLC_ERC20;
  let token: Awaited<ReturnType<typeof ethers.getContractFactory>> extends { deploy: () => Promise<infer T> } ? T : never;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let maker: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let taker: Awaited<ReturnType<typeof ethers.getSigners>>[0];

  const preimage = ethers.encodeBytes32String("erc20_secret_abc");
  const hashlock = ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));

  const TOKENS = ethers.parseEther("1000");
  const ONE_DAY = 86400;

  beforeEach(async function () {
    [owner, maker, taker] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("TestToken", "TT", ethers.parseEther("1000000"));

    // Deploy HTLC_ERC20
    const HTLC_ERC20 = await ethers.getContractFactory("HTLC_ERC20");
    htlc = await HTLC_ERC20.deploy();

    // Fund maker with tokens
    await token.transfer(maker.address, TOKENS * 10n);
  });

  describe("create()", function () {
    it("locks ERC20 tokens", async function () {
      const htlcAddr = await htlc.getAddress();
      const tokenAddr = await token.getAddress();
      await token.connect(maker).approve(htlcAddr, TOKENS);

      const expiry = (await time.latest()) + ONE_DAY;
      await htlc.connect(maker).create(tokenAddr, TOKENS, hashlock, expiry, ethers.ZeroAddress);

      expect(await token.balanceOf(htlcAddr)).to.equal(TOKENS);
      const order = await htlc.getOrder(1);
      expect(order.amount).to.equal(TOKENS);
      expect(order.token).to.equal(tokenAddr);
      expect(order.status).to.equal(1); // Open
    });

    it("locks tokens + native ETH", async function () {
      const htlcAddr = await htlc.getAddress();
      const tokenAddr = await token.getAddress();
      await token.connect(maker).approve(htlcAddr, TOKENS);

      const ethAmount = ethers.parseEther("0.5");
      const expiry = (await time.latest()) + ONE_DAY;
      await htlc.connect(maker).create(tokenAddr, TOKENS, hashlock, expiry, ethers.ZeroAddress, { value: ethAmount });

      const order = await htlc.getOrder(1);
      expect(order.nativeAmount).to.equal(ethAmount);
    });
  });

  describe("claim()", function () {
    beforeEach(async function () {
      const htlcAddr = await htlc.getAddress();
      const tokenAddr = await token.getAddress();
      await token.connect(maker).approve(htlcAddr, TOKENS);
      const expiry = (await time.latest()) + ONE_DAY;
      await htlc.connect(maker).create(tokenAddr, TOKENS, hashlock, expiry, ethers.ZeroAddress);
    });

    it("claims tokens with valid preimage", async function () {
      await htlc.connect(taker).claim(1, preimage);

      const expectedPayout = TOKENS * 99n / 100n; // 1% fee
      expect(await token.balanceOf(taker.address)).to.equal(expectedPayout);

      const expectedFee = TOKENS / 100n;
      expect(await token.balanceOf(owner.address)).to.be.gte(expectedFee);

      const order = await htlc.getOrder(1);
      expect(order.status).to.equal(2); // Claimed
    });
  });

  describe("refund()", function () {
    beforeEach(async function () {
      const htlcAddr = await htlc.getAddress();
      const tokenAddr = await token.getAddress();
      await token.connect(maker).approve(htlcAddr, TOKENS);
      const expiry = (await time.latest()) + 3600; // 1 hour
      await htlc.connect(maker).create(tokenAddr, TOKENS, hashlock, expiry, ethers.ZeroAddress);
    });

    it("refunds tokens after expiry", async function () {
      const balBefore = await token.balanceOf(maker.address);
      await time.increase(3601);
      await htlc.connect(maker).refund(1);
      const balAfter = await token.balanceOf(maker.address);
      expect(balAfter - balBefore).to.equal(TOKENS);
    });
  });
});
