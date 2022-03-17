const { expect } = require("chai");
const { BigNumber } = require("@ethersproject/bignumber");
const fs = require('fs');
const seedrandom = require('seedrandom');

let generator = seedrandom('apeX');

describe("Simulations", function () {
  let owner;
  let treasury;
  let weth;
  let router;
  let priceOracle;
  let baseToken;
  let quoteToken;
  let v3factory;
  let pool1;
  let config;
  let margin;
  let ammAddress;
  let amm;
  let provider = ethers.provider;
  let beta = 50;
  let leverage = 10;
  let arbThreshold = 1005;
  const ARB_MULTIPLIER = 1000;

  const tokenQuantity = ethers.utils.parseUnits("250000", "ether");
  const baseLiquidity = ethers.utils.parseUnits("500", "ether");
  const infDeadline = "9999999999";

  // normal distribution needed for geometric brownian motion of price in
  // stochastic simulation

  // Standard Normal variate using Box-Muller transform.
  function randn_bm() {
      return Math.sqrt(-2 * Math.log(1 - generator())) * Math.cos(2 * Math.PI * generator())
  }

  beforeEach(async function () {
    [owner, treasury, alice, bob, arbitrageur] = await ethers.getSigners();

    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();

    const MockToken = await ethers.getContractFactory("MockToken");
    baseToken = await MockToken.deploy("Base Token", "BT");
    quoteToken = await MockToken.deploy("Quote Token", "QT");

    const Config = await ethers.getContractFactory("Config");
    config = await Config.deploy();

    const MockUniswapV3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
    v3factory = await MockUniswapV3Factory.deploy();
    const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool");
    pool1 = await MockUniswapV3Pool.deploy(baseToken.address, quoteToken.address, 500);
    await pool1.setLiquidity(1000000000);
    await v3factory.setPool(baseToken.address, quoteToken.address, 500, pool1.address);

    const PriceOracle = await ethers.getContractFactory("PriceOracleForTest");
    priceOracle = await PriceOracle.deploy();
    await priceOracle.setReserve(baseToken.address, quoteToken.address, ethers.utils.parseUnits('1', 'ether'), ethers.utils.parseUnits('2000', 'ether'));
    await config.setPriceOracle(priceOracle.address);

    const PairFactory = await ethers.getContractFactory("PairFactory");
    pairFactory = await PairFactory.deploy();

    const AmmFactory = await ethers.getContractFactory("AmmFactory");
    const MarginFactory = await ethers.getContractFactory("MarginFactory");
    let ammFactory = await AmmFactory.deploy(pairFactory.address, config.address, owner.address);
    let marginFactory = await MarginFactory.deploy(pairFactory.address, config.address);
    await pairFactory.init(ammFactory.address, marginFactory.address);
    await pairFactory.createPair(baseToken.address, quoteToken.address);

    let marginAddress = await pairFactory.getMargin(baseToken.address, quoteToken.address);
    const Margin = await ethers.getContractFactory("Margin");
    margin = await Margin.attach(marginAddress);

    ammAddress = await pairFactory.getAmm(baseToken.address, quoteToken.address);
    const Amm = await ethers.getContractFactory("Amm");
    amm = await Amm.attach(ammAddress);

    const Router = await ethers.getContractFactory("Router");
    router = await Router.deploy(pairFactory.address, treasury.address, weth.address);
    await config.registerRouter(router.address);

    await baseToken.mint(owner.address, baseLiquidity);
    await baseToken.connect(owner).approve(router.address, baseLiquidity);
    await router.addLiquidity(baseToken.address, quoteToken.address, baseLiquidity, 1, infDeadline, false);

    await config.setBeta(beta);
  });

  describe.skip("check pool pnl given beta", function () {
    it("liquidates a position properly", async function () {
      await baseToken.mint(alice.address, tokenQuantity);
      await baseToken.connect(alice).approve(router.address, tokenQuantity);
      await baseToken.mint(bob.address, tokenQuantity);
      await baseToken.connect(bob).approve(router.address, tokenQuantity);

      let reserves = await amm.getReserves();
      let ammXpreTrade = reserves[0];
      console.log("ammXpreTrade: ", ammXpreTrade.toString());

      await router.connect(alice).openPositionWithWallet(baseToken.address, quoteToken.address, 0, ethers.utils.parseUnits("1", "ether"), ethers.utils.parseUnits("20000", "ether"), 1, infDeadline);

      reserves = await amm.getReserves();
      let ammXpostTrade = reserves[0];
      console.log("ammXpostTrade: ", ammXpostTrade.toString());
      let baseAmount = ammXpreTrade.sub(ammXpostTrade);
      // let originalBaseAmount = baseAmount.add(marginAmount);

      console.log(baseAmount.toString());
      // console.log(originalBaseAmount);

      await router.connect(bob).openPositionWithWallet(baseToken.address, quoteToken.address, 1, ethers.utils.parseUnits("100", "ether"), ethers.utils.parseUnits("10000", "ether"), ethers.utils.parseUnits("100000", "ether"), infDeadline);

      reserves = await amm.getReserves();
      let ammXpreLiq = reserves[0];

      console.log("ammXpreLiq: ", ammXpreLiq.toString());
      //let position = await margin.getPosition(alice.address);
      //console.log(position[1].toString());

      await margin.liquidate(alice.address, owner.address);

      reserves = await amm.getReserves();
      let ammXpostLiq = reserves[0];
      console.log("ammXpostLiq: " + ammXpostLiq.toString());
      let pnl = ammXpostLiq.sub(ammXpreLiq);
      console.log(pnl.toString());

      position = await margin.getPosition(alice.address);
      console.log(position[1].toString());
      console.log(baseAmount.sub(pnl).toString());

      // check that alice's position has been liquidated
      expect(position[2].isZero()).to.be.true;

      await router.connect(bob).closePosition(baseToken.address, quoteToken.address, 10000, infDeadline, true);
    });
  });

  describe("simulation involving arbitrageur and random trades", function () {
    it("generates simulation data", async function () {
      let simSteps = 750;
      let logger = fs.createWriteStream('sim_' + beta + '_' + simSteps + '.csv');
      logger.write("Trade, Oracle Price, Pool Price, Liquidation, Liquidation Entry Price, Pool PnL\n");

      await baseToken.mint(arbitrageur.address, tokenQuantity);
      await baseToken.connect(arbitrageur).approve(router.address, tokenQuantity);

      // variables for geometric brownian motion
      let mu = 0;
      let sig = 0.002;
      let lastPrice = 2000;

      // variables for the hawkes process simulation
      let lambda0 = 1;
      let a = lambda0;
      let lambdaTplus = lambda0;
      let lambdaTminus;
      let delta = 0.5;
      let meanJump = 0.22;
      let S;

      // active open trades
      let trades = [];

      // Exact simulation of Hawkes process with exponentially decaying intensity 2013
      for (let i = 0; i < simSteps; i++) {
        if (i%25 === 0) console.log("SIMULATION STEP #" + i + "\n");
        let u = generator();
        // TODO div by zero? 1st round
        let D = 1 + delta * Math.log(u) / (lambdaTplus - a);

        if (D > 0) {
          S = Math.min(1 + delta*Math.log(u), -(1/a) * Math.log(generator()));
        } else {
          S = -(1/a) * Math.log(generator());
        }

        lambdaTminus = (lambdaTplus-a) * Math.exp(-delta*S) + a;
        lambdaTplus = lambdaTminus + meanJump;

        // update price in price oracle by geometric brownian motion
        lastPrice = lastPrice * Math.exp((mu - sig*sig / 2) * 0.02 + sig * randn_bm());
        await priceOracle.setReserve(baseToken.address, quoteToken.address, ethers.utils.parseUnits("1", "ether"), ethers.utils.parseUnits(Math.floor(lastPrice * 1000000000000).toString(), 6));
        let price = await priceOracle.getIndexPrice(ammAddress);

        let reserves = await amm.getReserves();
        let lastPriceAmm = reserves[1].mul(ethers.utils.parseUnits("1", "ether")).div(reserves[0]);

        // arbitrageur gets opportunity to take his trade (should change arb trade sizes? TODO)
        if (lastPriceAmm * ARB_MULTIPLIER / price > arbThreshold) {
            await router.connect(arbitrageur).openPositionWithWallet(baseToken.address, quoteToken.address, 1, ethers.utils.parseUnits("5", "ether"), ethers.utils.parseUnits("2500", "ether"), ethers.utils.parseUnits("1000000", "ether"), infDeadline);
        } else if (price * ARB_MULTIPLIER / lastPriceAmm > arbThreshold) {
            await router.connect(arbitrageur).openPositionWithWallet(baseToken.address, quoteToken.address, 0, ethers.utils.parseUnits("5", "ether"), ethers.utils.parseUnits("2500", "ether"), 1, infDeadline);
        }

        reserves = await amm.getReserves();
        lastPriceAmm = reserves[1].mul(ethers.utils.parseUnits("1", "ether")).div(reserves[0]);

        // consider that a trade occurs whenever S is negative, this happens
        // roughly 10% of the time w/ delta = 0.3, w/ delta = 0.2 it's 1.5% of
        // the time
        if (S < 0) {
          let trader = await ethers.Wallet.createRandom().connect(provider);
          let tx = await owner.sendTransaction({
              to: trader.address,
              value: ethers.utils.parseEther("25.0")
          });
          await baseToken.mint(trader.address, tokenQuantity);
          await baseToken.connect(trader).approve(router.address, tokenQuantity);

          let side;
          let quoteAmount = ethers.utils.parseUnits("5000", "ether");
          let marginAmount = quoteAmount.mul(ethers.utils.parseUnits("1", "ether")).div(lastPriceAmm).div(10);
          let reserves = await amm.getReserves();
          let ammXpreTrade = reserves[0];

          // trader trades randomly
          if (generator() > 0.5) {
            side = 0;
            await router.connect(trader).openPositionWithWallet(baseToken.address, quoteToken.address, side, marginAmount, quoteAmount, 1, infDeadline);
            logger.write("1, ");
          } else {
            side = 1;
            await router.connect(trader).openPositionWithWallet(baseToken.address, quoteToken.address, side, marginAmount, quoteAmount, ethers.utils.parseUnits("1000000", "ether"), infDeadline);
            logger.write("-1, ");
          }
          reserves = await amm.getReserves();
          let ammXpostTrade = reserves[0];
          //console.log(side);
          //console.log(ammXpreTrade.toString());
          //console.log(ammXpostTrade.toString());
          let baseAmount = ammXpreTrade.sub(ammXpostTrade);
          let originalBaseAmount = baseAmount.add(marginAmount);
          //console.log(marginAmount.toString());
          //console.log(baseAmount.toString());
          //console.log(originalBaseAmount.toString());
          trades.push([trader, lastPriceAmm, side, originalBaseAmount]);
        } else {
          logger.write("0, ");
        }

        logger.write(price + ", " + lastPriceAmm);

        reserves = await amm.getReserves();
        // get the price out of the 112x112 format & display with 18 decimal accuracy
        lastPriceAmm = reserves[1].mul(ethers.utils.parseUnits("1", "ether")).div(reserves[0]);

        let liq = false;

        for (let j = 0; j < trades.length; j++) {
          trader = trades[j][0];
          let canLiq = await margin.canLiquidate(trader.address);
          let position = await router.getPosition(baseToken.address, quoteToken.address, trader.address);
          if (canLiq) {
            let reserves = await amm.getReserves();
            let ammXpreLiq = reserves[0];
            await margin.liquidate(trader.address, owner.address);
            position = await router.getPosition(baseToken.address, quoteToken.address, trader.address);

            // verify that the position is zero'd out
            if (position.quoteSize.isZero()) {
              reserves = await amm.getReserves();
              let originalBaseAmount = trades[j][3];
              let ammXpostLiq = reserves[0];
              // the order of subtraction differs betweeen long/short only to
              // ensure results that are always positive
              let pnl = originalBaseAmount.sub(ammXpostLiq.sub(ammXpreLiq));
              if (trades[j][2] == 0) {
                logger.write(", 1, ");
              } else {
                logger.write(", -1, ");
              }
              logger.write(trades[j][1] + ", " + pnl + "\n");
              liq = true;
              trades.splice(j, 1);
              break;
            } else {
              console.log("Failed to Liquidate!", position);
            }
          }
        }
        if (!liq) logger.write(", 0, 0, 0\n");
      }
      logger.end();
    });
  });
});
