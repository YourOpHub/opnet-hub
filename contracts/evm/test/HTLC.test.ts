import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HTLC } from "../typechain-types";

describe("HTLC (Native ETH)", function () {
  let htlc: HTLC;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let maker: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let taker: Awaited<ReturnType<typeof ethers.getSigners>>[0];

  // Test preimage and hashlock
  const preimage = ethers.encodeBytes32String("secret_preimage_123");
  const hashlock = ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));

  const ONE_ETH = ethers.parseEther("1.0");
  const ONE_HOUR = 3600;
  const ONE_DAY = 86400;

  beforeEach(async function () {
    [owner, maker, taker] = await ethers.getSigners();
    const HTLC = await ethers.getContractFactory("HTLC");
    htlc = await HTLC.deploy();
  });

  describe("create()", function () {
    it("creates order and locks ETH", async function () {
      const expiry = (await time.latest()) + ONE_DAY;
      const tx = await htlc.connect(maker).create(hashlock, expiry, ethers.ZeroAddress, { value: ONE_ETH });
      const receipt = await tx.wait();

      expect(await ethers.provider.getBalance(await htlc.getAddress())).to.equal(ONE_ETH);

      const order = await htlc.getOrder(1);
      expect(order.maker).to.equal(maker.address);
      expect(order.amount).to.equal(ONE_ETH);
      expect(order.hashlock).to.equal(hashlock);
      expect(order.status).to.equal(1); // Open
    });

    it("reverts on zero value", async function () {
      const expiry = (await time.latest()) + ONE_DAY;
      await expect(htlc.connect(maker).create(hashlock, expiry, ethers.ZeroAddress))
        .to.be.revertedWith("Must lock ETH");
    });

    it("reverts on expiry too soon", async function () {
      const expiry = (await time.latest()) + 60; // 1 min
      await expect(htlc.connect(maker).create(hashlock, expiry, ethers.ZeroAddress, { value: ONE_ETH }))
        .to.be.revertedWith("Expiry too soon");
    });

    it("reverts on expiry too far", async function () {
      const expiry = (await time.latest()) + 8 * ONE_DAY;
      await expect(htlc.connect(maker).create(hashlock, expiry, ethers.ZeroAddress, { value: ONE_ETH }))
        .to.be.revertedWith("Expiry too far");
    });

    it("increments order ID", async function () {
      const expiry = (await time.latest()) + ONE_DAY;
      await htlc.connect(maker).create(hashlock, expiry, ethers.ZeroAddress, { value: ONE_ETH });
      expect(await htlc.nextOrderId()).to.equal(2);

      const hashlock2 = ethers.sha256(ethers.solidityPacked(["bytes32"], [ethers.encodeBytes32String("secret2")]));
      await htlc.connect(maker).create(hashlock2, expiry, ethers.ZeroAddress, { value: ONE_ETH });
      expect(await htlc.nextOrderId()).to.equal(3);
    });
  });

  describe("claim()", function () {
    let orderId: number;
    let expiry: number;

    beforeEach(async function () {
      expiry = (await time.latest()) + ONE_DAY;
      await htlc.connect(maker).create(hashlock, expiry, ethers.ZeroAddress, { value: ONE_ETH });
      orderId = 1;
    });

    it("claims with valid preimage", async function () {
      const balBefore = await ethers.provider.getBalance(taker.address);
      const tx = await htlc.connect(taker).claim(orderId, preimage);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balAfter = await ethers.provider.getBalance(taker.address);
      // 1 ETH - 1% fee = 0.99 ETH
      const expected = ONE_ETH * 99n / 100n;
      expect(balAfter - balBefore + gasUsed).to.equal(expected);

      const order = await htlc.getOrder(orderId);
      expect(order.status).to.equal(2); // Claimed
    });

    it("sends fee to owner", async function () {
      const ownerBal = await ethers.provider.getBalance(owner.address);
      await htlc.connect(taker).claim(orderId, preimage);
      const ownerBalAfter = await ethers.provider.getBalance(owner.address);

      const expectedFee = ONE_ETH / 100n; // 1%
      expect(ownerBalAfter - ownerBal).to.equal(expectedFee);
    });

    it("reverts on invalid preimage", async function () {
      const wrongPreimage = ethers.encodeBytes32String("wrong_secret");
      await expect(htlc.connect(taker).claim(orderId, wrongPreimage))
        .to.be.revertedWith("Invalid preimage");
    });

    it("reverts if expired", async function () {
      await time.increase(ONE_DAY + 1);
      await expect(htlc.connect(taker).claim(orderId, preimage))
        .to.be.revertedWith("Expired");
    });

    it("reverts if wrong taker", async function () {
      // Create with specific taker
      const expiry2 = (await time.latest()) + ONE_DAY;
      const hashlock2 = ethers.sha256(ethers.solidityPacked(["bytes32"], [ethers.encodeBytes32String("s2")]));
      await htlc.connect(maker).create(hashlock2, expiry2, taker.address, { value: ONE_ETH });

      await expect(htlc.connect(maker).claim(2, ethers.encodeBytes32String("s2")))
        .to.be.revertedWith("Not authorized taker");
    });

    it("reverts double claim", async function () {
      await htlc.connect(taker).claim(orderId, preimage);
      await expect(htlc.connect(taker).claim(orderId, preimage))
        .to.be.revertedWith("Not open");
    });
  });

  describe("refund()", function () {
    let orderId: number;

    beforeEach(async function () {
      const expiry = (await time.latest()) + ONE_HOUR;
      await htlc.connect(maker).create(hashlock, expiry, ethers.ZeroAddress, { value: ONE_ETH });
      orderId = 1;
    });

    it("refunds after expiry", async function () {
      await time.increase(ONE_HOUR + 1);

      const balBefore = await ethers.provider.getBalance(maker.address);
      const tx = await htlc.connect(maker).refund(orderId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balAfter = await ethers.provider.getBalance(maker.address);
      expect(balAfter - balBefore + gasUsed).to.equal(ONE_ETH);

      const order = await htlc.getOrder(orderId);
      expect(order.status).to.equal(3); // Refunded
    });

    it("reverts before expiry", async function () {
      await expect(htlc.connect(maker).refund(orderId))
        .to.be.revertedWith("Not expired yet");
    });

    it("reverts if not maker", async function () {
      await time.increase(ONE_HOUR + 1);
      await expect(htlc.connect(taker).refund(orderId))
        .to.be.revertedWith("Not maker");
    });
  });

  describe("setFee()", function () {
    it("updates fee", async function () {
      await htlc.setFee(200);
      expect(await htlc.feeBps()).to.equal(200);
    });

    it("reverts if fee too high", async function () {
      await expect(htlc.setFee(501)).to.be.revertedWith("Fee too high");
    });

    it("reverts if not owner", async function () {
      await expect(htlc.connect(taker).setFee(200)).to.be.revertedWith("Not owner");
    });
  });
});
