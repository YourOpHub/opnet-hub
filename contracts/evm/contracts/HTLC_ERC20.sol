// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title HTLC_ERC20 — Hash Time-Locked Contract for ERC20 tokens
 * @notice Lock ERC20 tokens with SHA256 hashlock + timelock for cross-chain atomic swaps.
 *
 * Works on all EVM chains: Ethereum, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche, etc.
 *
 * Flow:
 *   1. Maker approves this contract, then calls create() to lock tokens
 *   2. Counterparty reveals preimage → claim() releases tokens
 *   3. If expired, maker calls refund()
 */
contract HTLC_ERC20 {
    using SafeERC20 for IERC20;

    enum OrderStatus { Invalid, Open, Claimed, Refunded }

    struct Order {
        address maker;
        address taker;          // 0x0 = anyone can claim
        address token;          // ERC20 token address
        uint256 amount;         // token amount locked
        uint256 nativeAmount;   // optional native ETH/BNB locked (for gas reimbursement)
        bytes32 hashlock;       // SHA256(preimage)
        uint256 expiry;         // block.timestamp deadline
        OrderStatus status;
    }

    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;

    address public owner;
    uint256 public feeBps = 100; // 1% default
    uint256 public constant MAX_FEE_BPS = 500;
    uint256 public constant MIN_EXPIRY = 1 hours;
    uint256 public constant MAX_EXPIRY = 7 days;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        address taker,
        address token,
        uint256 amount,
        uint256 nativeAmount,
        bytes32 hashlock,
        uint256 expiry
    );
    event OrderClaimed(uint256 indexed orderId, address indexed claimer, bytes32 preimage);
    event OrderRefunded(uint256 indexed orderId, address indexed maker);
    event FeeUpdated(uint256 newFeeBps);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Create an HTLC order by locking ERC20 tokens (+ optional native tokens)
     * @param token ERC20 token to lock
     * @param amount Number of tokens to lock (must be approved first)
     * @param hashlock SHA256 hash of the secret preimage
     * @param expiry Unix timestamp when the order expires
     * @param taker Specific taker (0x0 for anyone)
     */
    function create(
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 expiry,
        address taker
    ) external payable returns (uint256 orderId) {
        require(amount > 0, "Must lock tokens");
        require(token != address(0), "Invalid token");
        require(hashlock != bytes32(0), "Invalid hashlock");
        require(expiry >= block.timestamp + MIN_EXPIRY, "Expiry too soon");
        require(expiry <= block.timestamp + MAX_EXPIRY, "Expiry too far");

        // Transfer tokens from maker to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        orderId = nextOrderId++;
        orders[orderId] = Order({
            maker: msg.sender,
            taker: taker,
            token: token,
            amount: amount,
            nativeAmount: msg.value,
            hashlock: hashlock,
            expiry: expiry,
            status: OrderStatus.Open
        });

        emit OrderCreated(orderId, msg.sender, taker, token, amount, msg.value, hashlock, expiry);
    }

    /**
     * @notice Claim locked tokens by revealing the preimage
     */
    function claim(uint256 orderId, bytes32 preimage) external {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.Open, "Not open");
        require(block.timestamp < order.expiry, "Expired");
        require(
            order.taker == address(0) || order.taker == msg.sender,
            "Not authorized"
        );

        bytes32 computed = sha256(abi.encodePacked(preimage));
        require(computed == order.hashlock, "Invalid preimage");

        order.status = OrderStatus.Claimed;

        // Token transfer with fee
        uint256 fee = (order.amount * feeBps) / 10000;
        uint256 payout = order.amount - fee;

        IERC20(order.token).safeTransfer(msg.sender, payout);
        if (fee > 0) {
            IERC20(order.token).safeTransfer(owner, fee);
        }

        // Native token transfer (if any)
        if (order.nativeAmount > 0) {
            uint256 nativeFee = (order.nativeAmount * feeBps) / 10000;
            uint256 nativePayout = order.nativeAmount - nativeFee;
            (bool ok, ) = payable(msg.sender).call{value: nativePayout}("");
            require(ok, "Native transfer failed");
            if (nativeFee > 0) {
                (bool feeOk, ) = payable(owner).call{value: nativeFee}("");
                require(feeOk, "Fee transfer failed");
            }
        }

        emit OrderClaimed(orderId, msg.sender, preimage);
    }

    /**
     * @notice Refund locked tokens after expiry
     */
    function refund(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.Open, "Not open");
        require(block.timestamp >= order.expiry, "Not expired");
        require(msg.sender == order.maker, "Not maker");

        order.status = OrderStatus.Refunded;

        IERC20(order.token).safeTransfer(order.maker, order.amount);

        if (order.nativeAmount > 0) {
            (bool ok, ) = payable(order.maker).call{value: order.nativeAmount}("");
            require(ok, "Refund failed");
        }

        emit OrderRefunded(orderId, order.maker);
    }

    function setFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Fee too high");
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid");
        owner = newOwner;
    }

    function getOrder(uint256 orderId) external view returns (
        address maker, address taker, address token, uint256 amount,
        uint256 nativeAmount, bytes32 hashlock, uint256 expiry, OrderStatus status
    ) {
        Order storage o = orders[orderId];
        return (o.maker, o.taker, o.token, o.amount, o.nativeAmount, o.hashlock, o.expiry, o.status);
    }
}
