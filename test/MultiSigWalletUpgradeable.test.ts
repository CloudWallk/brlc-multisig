import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'MultiSigWalletUpgradeable'", () => {
  const REQUIRED_APPROVALS = 2;
  const ONE_YEAR = 3600 * 24 * 365;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";

  const REVERT_ERROR_IF_DUPLICATE_OWNER_ADDRESS = "DuplicateOwnerAddress";
  const REVERT_ERROR_IF_EMPTY_OWNERS_ARRAY = "EmptyOwnersArray";
  const REVERT_ERROR_IF_INVALID_REQUIRED_APPROVALS = "InvalidRequiredApprovals";
  const REVERT_ERROR_IF_ZERO_OWNER_ADDRESS = "ZeroOwnerAddress";
  const REVERT_ERROR_UNAUTHORIZED_CALLER = "UnauthorizedCaller";

  let tokenFactory: ContractFactory;
  let walletUpgradeableFactory: ContractFactory;
  let walletFactory: ContractFactory;
  let proxyAdminFactory: ContractFactory;

  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let user: SignerWithAddress;

  let ownerAddresses: string[];

  before(async () => {
    [deployer, owner1, owner2, owner3, user] = await ethers.getSigners();
    ownerAddresses = [owner1.address, owner2.address, owner3.address];
    walletUpgradeableFactory = await ethers.getContractFactory("MultiSigWalletUpgradeable");
    walletFactory = await ethers.getContractFactory("MultiSigWallet");
    tokenFactory = await ethers.getContractFactory("TestContractMock");
    proxyAdminFactory = await ethers.getContractFactory("ProxyAdminMock");
  });

  async function checkOwnership(
    wallet: Contract,
    options: { ownerAddresses: string[]; expectedOwnershipStatus: boolean }
  ) {
    for (let i = 0; i < options.ownerAddresses.length; ++i) {
      const address = options.ownerAddresses[i];
      expect(await wallet.isOwner(address)).to.eq(
        options.expectedOwnershipStatus,
        `Wrong ownership status for address: ${address}`
      );
    }
  }

  async function deployWalletUpgradeable(): Promise<{ wallet: Contract }> {
    const wallet = await upgrades.deployProxy(walletUpgradeableFactory, [ownerAddresses, REQUIRED_APPROVALS]);
    await wallet.deployed();

    return {
      wallet
    };
  }

  async function deployWalletImplementation(): Promise<{
    walletImplementation: Contract;
  }> {
    const walletImplementation = await walletFactory.deploy(ownerAddresses, REQUIRED_APPROVALS);
    await walletImplementation.deployed();

    return {
      walletImplementation
    };
  }

  async function deployAllContracts(): Promise<{
    wallet: Contract;
    walletImplementation: Contract;
  }> {
    const { wallet } = await deployWalletUpgradeable();
    const { walletImplementation } = await deployWalletImplementation();

    return {
      wallet,
      walletImplementation
    };
  }

  async function encodeUpgradeFunctionData(newImplementation: string) {
    const { wallet } = await deployWalletUpgradeable();
    let ABI = ["function upgradeTo(address newImplementation)"];
    const upgradeInterface = new ethers.utils.Interface(ABI);
    const upgradeData = await upgradeInterface.encodeFunctionData("upgradeTo", [newImplementation]);
    return upgradeData;
  }

  describe("Function 'initialize()'", () => {
    it("Configures the contract as expected", async () => {
      const { wallet } = await setUpFixture(deployWalletUpgradeable);

      expect(await wallet.owners()).to.deep.eq(ownerAddresses);
      expect(await wallet.requiredApprovals()).to.eq(REQUIRED_APPROVALS);
      expect(await wallet.transactionCount()).to.eq(0);
      expect(await wallet.cooldownTime()).to.eq(0);
      expect(await wallet.expirationTime()).to.eq(ONE_YEAR);
      await checkOwnership(wallet, {
        ownerAddresses,
        expectedOwnershipStatus: true
      });
    });

    it("Is reverted if it is called a second time", async () => {
      const { wallet } = await setUpFixture(deployWalletUpgradeable);
      await expect(
        wallet.initialize(ownerAddresses, REQUIRED_APPROVALS)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the input owner array is empty", async () => {
      const uninitializedWallet = await upgrades.deployProxy(walletUpgradeableFactory, [], { initializer: false });
      await expect(
        uninitializedWallet.initialize([], 0)
      ).to.be.revertedWithCustomError(walletUpgradeableFactory, REVERT_ERROR_IF_EMPTY_OWNERS_ARRAY);
    });

    it("Is reverted if the input number of required approvals is zero", async () => {
      const uninitializedWallet = await upgrades.deployProxy(walletUpgradeableFactory, [], { initializer: false });
      const requiredApprovals = 0;
      await expect(
        uninitializedWallet.initialize(ownerAddresses, requiredApprovals)
      ).to.be.revertedWithCustomError(walletUpgradeableFactory, REVERT_ERROR_IF_INVALID_REQUIRED_APPROVALS);
    });

    it("Is reverted if the input number of required approvals exceeds the length of the input owner array", async () => {
      const uninitializedWallet = await upgrades.deployProxy(walletUpgradeableFactory, [], { initializer: false });
      const requiredApprovals = ownerAddresses.length + 1;
      await expect(
        uninitializedWallet.initialize(ownerAddresses, requiredApprovals)
      ).to.be.revertedWithCustomError(walletUpgradeableFactory, REVERT_ERROR_IF_INVALID_REQUIRED_APPROVALS);
    });

    it("Is reverted if one of the input owners is the zero address", async () => {
      const uninitializedWallet = await upgrades.deployProxy(walletUpgradeableFactory, [], { initializer: false });
      const ownerAddressArray = [ownerAddresses[0], ownerAddresses[1], ethers.constants.AddressZero];
      const requiredApprovals = ownerAddressArray.length - 1;
      await expect(
        uninitializedWallet.initialize(ownerAddressArray, requiredApprovals)
      ).to.be.revertedWithCustomError(walletUpgradeableFactory, REVERT_ERROR_IF_ZERO_OWNER_ADDRESS);
    });

    it("Is reverted if there is a duplicate address in the input owner array", async () => {
      const uninitializedWallet = await upgrades.deployProxy(walletUpgradeableFactory, [], { initializer: false });
      const ownerAddressArray = [ownerAddresses[0], ownerAddresses[1], ownerAddresses[0]];
      const requiredApprovals = ownerAddresses.length - 1;
      await expect(
        uninitializedWallet.initialize(ownerAddressArray, requiredApprovals)
      ).to.be.revertedWithCustomError(walletUpgradeableFactory, REVERT_ERROR_IF_DUPLICATE_OWNER_ADDRESS);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const wallet = await walletUpgradeableFactory.deploy();
      await wallet.deployed();

      await expect(
        wallet.initialize(ownerAddresses, REQUIRED_APPROVALS)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Scenarios with contract upgrades", () => {
    it("Upgrade is reverted if caller is not a multisig", async () => {
      const { wallet } = await setUpFixture(deployAllContracts);

      await expect(
        wallet.upgradeTo(wallet.address)
      ).to.be.revertedWithCustomError(wallet, REVERT_ERROR_UNAUTHORIZED_CALLER);
    });
  });
});
