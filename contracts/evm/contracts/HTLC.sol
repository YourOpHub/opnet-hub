// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title HTLC — Hash Time-Locked Contract for cross-chain atomic swaps
 * @notice Lock ETH/native tokens with SHA256 hashlock + timelock.
 *         Counterparty reveals preimage to claim, or maker refunds after expiry.
 *
 * Flow:
 *   1. Maker calls create() with hashlock + timelock, locks ETH
 *   2. Counterparty reveals preimage → claim()
 *   3. If expired, maker calls refund()
 *
 * For OPNet cross-chain swaps:
 *   - Maker locks ETH on EVM side
 *   - Taker locks BTC on OPNet side using same hashlock
 *   - One side reveals preimage → both sides can claim
 */
contract HTLC {
    enum OrderStatus { Invalid, Open, Claimed, Refunded }

    struct Order {
        address maker;
        address taker;      // 0x0 = anyone can claim
        uint256 amount;
        bytes32 hashlock;   // SHA256(preimage)
        uint256 expiry;     // block.timestamp deadline
        OrderStatus status;
    }

    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;

    // Fee config (owner-controlled)
    address public owner;
    uint256 public feeBps = 100; // 1%
    uint256 public constant MAX_FEE_BPS = 500; // 5% max
    uint256 public constant MIN_EXPIRY = 1 hours;
    uint256 public constant MAX_EXPIRY = 7 days;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        address taker,
        uint256 amount,
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
     * @notice Create a new HTLC order by locking ETH
     * @param hashlock SHA256 hash of the secret preimage
     * @param expiry Unix timestamp when the order expires
     * @param taker Specific taker address (0x0 for anyone)
     */
    function create(
        bytes32 hashlock,
        uint256 expiry,
        address taker
    ) external payable returns (uint256 orderId) {
        require(msg.value > 0, "Must lock ETH");
        require(hashlock != bytes32(0), "Invalid hashlock");
        require(expiry >= block.timestamp + MIN_EXPIRY, "Expiry too soon");
        require(expiry <= block.timestamp + MAX_EXPIRY, "Expiry too far");

        orderId = nextOrderId++;
        orders[orderId] = Order({
            maker: msg.sender,
            taker: taker,
            amount: msg.value,
            hashlock: hashlock,
            expiry: expiry,
            status: OrderStatus.Open
        });

        emit OrderCreated(orderId, msg.sender, taker, msg.value, hashlock, expiry);
    }

    /**
     * @notice Claim locked ETH by revealing the preimage
     * @param orderId The order to claim
     * @param preimage The secret whose SHA256 matches the hashlock
     */
    function claim(uint256 orderId, bytes32 preimage) external {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.Open, "Not open");
        require(block.timestamp < order.expiry, "Expired");
        require(
            order.taker == address(0) || order.taker == msg.sender,
            "Not authorized taker"
        );

        // Verify preimage
        bytes32 computed = sha256(abi.encodePacked(preimage));
        require(computed == order.hashlock, "Invalid preimage");

        order.status = OrderStatus.Claimed;

        // Calculate and deduct fee
        uint256 fee = (order.amount * feeBps) / 10000;
        uint256 payout = order.amount - fee;

        // Transfer to claimer
        (bool ok, ) = payable(msg.sender).call{value: payout}("");
        require(ok, "Transfer failed");

        // Fee to owner
        if (fee > 0) {
            (bool feeOk, ) = payable(owner).call{value: fee}("");
            require(feeOk, "Fee transfer failed");
        }

        emit OrderClaimed(orderId, msg.sender, preimage);
    }

    /**
     * @notice Refund locked ETH after expiry
     * @param orderId The expired order to refund
     */
    function refund(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.Open, "Not open");
        require(block.timestamp >= order.expiry, "Not expired yet");
        require(msg.sender == order.maker, "Not maker");

        order.status = OrderStatus.Refunded;

        (bool ok, ) = payable(order.maker).call{value: order.amount}("");
        require(ok, "Refund failed");

        emit OrderRefunded(orderId, order.maker);
    }

    /**
     * @notice Update fee (owner only)
     * @param newFeeBps New fee in basis points (max 500 = 5%)
     */
    function setFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Fee too high");
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }

    /**
     * @notice Get order details
     */
    function getOrder(uint256 orderId) external view returns (
        address maker,
        address taker,
        uint256 amount,
        bytes32 hashlock,
        uint256 expiry,
        OrderStatus status
    ) {
        Order storage o = orders[orderId];
        return (o.maker, o.taker, o.amount, o.hashlock, o.expiry, o.status);
    }
}
