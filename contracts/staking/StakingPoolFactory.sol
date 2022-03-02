// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "./interfaces/IStakingPool.sol";
import "./interfaces/IStakingPoolFactory.sol";
import "../utils/Initializable.sol";
import "../utils/Ownable.sol";
import "./StakingPool.sol";
import "./interfaces/IERC20Extend.sol";

//this is a stakingPool factory to create and register stakingPool, distribute ApeX token according to pools' weight
contract StakingPoolFactory is IStakingPoolFactory, Ownable, Initializable {
    address public override apeX;
    address public override esApeX;
    address public override stApeX;
    address public override treasury;
    uint256 public override lastUpdateTimestamp;
    uint256 public override secSpanPerUpdate;
    uint256 public override apeXPerSec;
    uint256 public override totalWeight;
    uint256 public override endTimestamp;
    uint256 public override lockTime;
    uint256 public override minRemainRatioAfterBurn; //10k-based
    uint256 public override remainForOtherVest; //100-based
    mapping(address => PoolInfo) public pools;
    mapping(address => address) public override poolTokenMap;

    //upgradableProxy StakingPoolFactory only initialized once
    function initialize(
        address _apeX,
        address _treasury,
        uint256 _apeXPerSec,
        uint256 _secSpanPerUpdate,
        uint256 _initTimestamp,
        uint256 _endTimestamp,
        uint256 _lockTime
    ) public initializer {
        require(_apeX != address(0), "cpf.initialize: INVALID_APEX");
        require(_treasury != address(0), "cpf.initialize: INVALID_TREASURY");
        require(_apeXPerSec > 0, "cpf.initialize: INVALID_PER_SEC");
        require(_secSpanPerUpdate > 0, "cpf.initialize: INVALID_UPDATE_SPAN");
        require(_initTimestamp > block.timestamp, "cpf.initialize: INVALID_INIT_TIMESTAMP");
        require(_endTimestamp > _initTimestamp, "cpf.initialize: INVALID_END_TIMESTAMP");
        require(_lockTime > 0, "cpf.initialize: INVALID_LOCK_TIME");

        owner = msg.sender;
        apeX = _apeX;
        treasury = _treasury;
        apeXPerSec = _apeXPerSec;
        secSpanPerUpdate = _secSpanPerUpdate;
        lastUpdateTimestamp = _initTimestamp;
        endTimestamp = _endTimestamp;
        lockTime = _lockTime;
    }

    function createPool(
        address _poolToken,
        uint256 _initTimestamp,
        uint256 _weight
    ) external override onlyOwner {
        IStakingPool pool = new StakingPool(address(this), _poolToken, apeX, _initTimestamp);
        registerPool(address(pool), _weight);
    }

    function registerPool(address _pool, uint256 _weight) public override onlyOwner {
        require(poolTokenMap[_pool] == address(0), "cpf.registerPool: POOL_REGISTERED");
        address poolToken = IStakingPool(_pool).poolToken();
        require(poolToken != address(0), "cpf.registerPool: ZERO_ADDRESS");

        pools[poolToken] = PoolInfo({pool: _pool, weight: _weight});
        poolTokenMap[_pool] = poolToken;
        totalWeight += _weight;

        emit PoolRegistered(msg.sender, poolToken, _pool, _weight);
    }

    function unregisterPool(address _pool) external override onlyOwner {
        require(poolTokenMap[_pool] != address(0), "cpf.unregisterPool: POOL_NOT_REGISTERED");
        address poolToken = IStakingPool(_pool).poolToken();

        totalWeight -= pools[poolToken].weight;
        delete pools[poolToken];
        delete poolTokenMap[_pool];

        emit PoolUnRegistered(msg.sender, poolToken, _pool);
    }

    function updateApeXPerSec() external override {
        uint256 currentTimestamp = block.timestamp;

        require(currentTimestamp >= lastUpdateTimestamp + secSpanPerUpdate, "cpf.updateApeXPerSec: TOO_FREQUENT");
        require(currentTimestamp <= endTimestamp, "cpf.updateApeXPerSec: END");

        apeXPerSec = (apeXPerSec * 97) / 100;
        lastUpdateTimestamp = currentTimestamp;

        emit UpdateApeXPerSec(apeXPerSec);
    }

    function transferYieldTo(address _to, uint256 _amount) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.transferYieldTo: ACCESS_DENIED");

        emit TransferYieldTo(msg.sender, _to, _amount);
        IERC20(apeX).transfer(_to, _amount);
    }

    function transferYieldToTreasury(uint256 _amount) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.transferYieldToTreasury: ACCESS_DENIED");

        address _treasury = treasury;
        emit TransferYieldToTreasury(msg.sender, _treasury, _amount);
        IERC20(apeX).transfer(_treasury, _amount);
    }

    function transferEsApeXTo(address _to, uint256 _amount) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.transferEsApeXTo: ACCESS_DENIED");

        emit TransferEsApeXTo(msg.sender, _to, _amount);
        IERC20(esApeX).transfer(_to, _amount);
    }

    function transferEsApeXFrom(
        address _from,
        address _to,
        uint256 _amount
    ) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.transferEsApeXFrom: ACCESS_DENIED");

        emit TransferEsApeXFrom(_from, _to, _amount);
        IERC20(esApeX).transferFrom(_from, _to, _amount);
    }

    function burnEsApeX(address from, uint256 amount) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.burnEsApeX: ACCESS_DENIED");
        IERC20Extend(esApeX).burn(from, amount);
    }

    function mintEsApeX(address to, uint256 amount) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.mintEsApeX: ACCESS_DENIED");
        IERC20Extend(esApeX).mint(to, amount);
    }

    function burnStApeX(address from, uint256 amount) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.burnStApeX: ACCESS_DENIED");
        IERC20Extend(stApeX).burn(from, amount);
    }

    function mintStApeX(address to, uint256 amount) external override {
        require(poolTokenMap[msg.sender] != address(0), "cpf.mintStApeX: ACCESS_DENIED");
        IERC20Extend(stApeX).mint(to, amount);
    }

    function changePoolWeight(address _pool, uint256 _weight) external override onlyOwner {
        address poolToken = poolTokenMap[_pool];
        require(poolToken != address(0), "cpf.changePoolWeight: POOL_NOT_EXIST");

        totalWeight = totalWeight + _weight - pools[poolToken].weight;
        pools[poolToken].weight = _weight;

        emit WeightUpdated(msg.sender, _pool, _weight);
    }

    function setLockTime(uint256 _lockTime) external onlyOwner {
        lockTime = _lockTime;

        emit SetYieldLockTime(_lockTime);
    }

    function setMinRemainRatioAfterBurn(uint256 _minRemainRatioAfterBurn) external override onlyOwner {
        require(_minRemainRatioAfterBurn <= 10000, "cpf.setMinRemainRatioAfterBurn: INVALID_VALUE");
        minRemainRatioAfterBurn = _minRemainRatioAfterBurn;
    }

    function setRemainForOtherVest(uint256 _remainForOtherVest) external override onlyOwner {
        require(_remainForOtherVest <= 100, "cpf.setRemainForOtherVest: INVALID_VALUE");
        remainForOtherVest = _remainForOtherVest;
    }

    function calStakingPoolApeXReward(uint256 _lastYieldDistribution, address _poolToken)
        external
        view
        override
        returns (uint256 reward)
    {
        uint256 currentTimestamp = block.timestamp;
        uint256 secPassed = currentTimestamp > endTimestamp
            ? endTimestamp - _lastYieldDistribution
            : currentTimestamp - _lastYieldDistribution;

        reward = (secPassed * apeXPerSec * pools[_poolToken].weight) / totalWeight;
    }

    function shouldUpdateRatio() external view override returns (bool) {
        uint256 currentTimestamp = block.timestamp;
        return currentTimestamp > endTimestamp ? false : currentTimestamp >= lastUpdateTimestamp + secSpanPerUpdate;
    }

    function getPoolAddress(address _poolToken) external view override returns (address) {
        return pools[_poolToken].pool;
    }

    function setEsApeX(address _esApeX) external override onlyOwner {
        require(esApeX == address(0), "cpf.setEsApeX: ADDRESS_SET_ALREADY");
        esApeX = _esApeX;

        emit SetEsApeX(_esApeX);
    }

    function setStApeX(address _stApeX) external override onlyOwner {
        require(stApeX == address(0), "cpf.setStApeX: ADDRESS_SET_ALREADY");
        stApeX = _stApeX;

        emit SetStApeX(_stApeX);
    }
}
