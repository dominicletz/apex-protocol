// SPDX-License-Identifier: Unlicense

pragma solidity ^0.8.0;

interface ICorePoolFactory {
    struct PoolInfo {
        address pool;
        uint256 weight;
    }

    event WeightUpdated(address indexed _by, address indexed pool, uint256 weight);

    event PoolRegistered(address indexed _by, address indexed poolToken, address indexed pool, uint256 weight);

    /// @notice get the endBlock number to yield, after this, no yield reward
    function endBlock() external view returns (uint256);

    /// @notice check if can update yield reward ratio
    function shouldUpdateRatio() external view returns (bool);

    /// @notice get corePool's poolToken
    function poolTokenMap(address pool) external view returns (address);

    /// @notice get corePool's address of poolToken
    /// @param poolToken staked token.
    function getPoolAddress(address poolToken) external view returns (address);

    /// @notice calculate yield reward of poolToken since lastYieldDistribution
    /// @param poolToken staked token.
    function calCorePoolApexReward(uint256 lastYieldDistribution, address poolToken)
        external
        view
        returns (uint256 reward);

    /// @notice update yield reward rate
    function updateApexPerBlock() external;

    /// @notice create a new corePool
    /// @param poolToken corePool staked token.
    /// @param initBlock when to yield reward.
    /// @param weight new pool's weight between all other corePools.
    function createPool(
        address poolToken,
        uint256 initBlock,
        uint256 weight
    ) external;

    /// @notice register an exist pool to factory
    /// @param pool the exist pool.
    /// @param weight pool's weight between all other corePools.
    function registerPool(address pool, uint256 weight) external;

    /// @notice mint apex to staker
    /// @param _to the staker.
    /// @param _amount apex amount.
    function mintYieldTo(address _to, uint256 _amount) external;

    /// @notice change a pool's weight
    /// @param poolAddr the pool.
    /// @param weight new weight.
    function changePoolWeight(address poolAddr, uint256 weight) external;
}
