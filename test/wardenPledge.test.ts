const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { WardenPledge } from "../typechain/WardenPledge";
import { IERC20 } from "../typechain/oz/interfaces/IERC20";
import { IERC20__factory } from "../typechain/factories/oz/interfaces/IERC20__factory";
import { IVotingEscrow } from "../typechain/interfaces/IVotingEscrow";
import { IVotingEscrow__factory } from "../typechain/factories/interfaces/IVotingEscrow__factory";
import { IBoostV2 } from "../typechain/interfaces/IBoostV2";
import { IBoostV2__factory } from "../typechain/factories/interfaces/IBoostV2__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import {
    advanceTime,
    getERC20,
    resetFork,
} from "./utils/utils";

import {
    TOKEN_ADDRESS,
    VOTING_ESCROW_ADDRESS,
    BOOST_DELEGATION_ADDRESS,
    BIG_HOLDER,
    VECRV_LOCKING_TIME,
    TOKENS,
    HOLDERS,
    AMOUNTS
} from "./utils/constant"

chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

const WEEK = BigNumber.from(7 * 86400);
const MAX_BPS = BigNumber.from(10000);
const UNIT = ethers.utils.parseEther('1')
const MAX_UINT = ethers.constants.MaxUint256

let wardenPledgeFactory: ContractFactory

const min_target_votes = ethers.utils.parseEther('1000')

const min_reward_per_vote = [
    ethers.utils.parseEther('0.000000005'),
    ethers.utils.parseEther('0.000000001')
]

describe('Warden Pledge contract tests', () => {
    let admin: SignerWithAddress
    let chest: SignerWithAddress
    let receiver: SignerWithAddress
    let externalUser: SignerWithAddress

    let wardenPledge: WardenPledge

    let creator: SignerWithAddress
    let other_creator: SignerWithAddress

    let delegator1: SignerWithAddress
    let delegator2: SignerWithAddress
    let delegator3: SignerWithAddress

    let CRV: IERC20
    let veCRV: IVotingEscrow
    let delegationBoost: IBoostV2

    let rewardToken1: IERC20
    let rewardToken2: IERC20

    let delegators: SignerWithAddress[]

    const crv_amount = ethers.utils.parseEther('4000000');
    const lock_amounts = [
        ethers.utils.parseEther('500000'),
        ethers.utils.parseEther('750000'),
        ethers.utils.parseEther('275000')
    ]

    const getRoundedTimestamp = (timestamp: BigNumber) => {
        return timestamp.div(WEEK).mul(WEEK)
    }

    const resetVeLock = async (user: SignerWithAddress, lock_amount: BigNumber) => {
        const locked_balance = (await veCRV.locked(user.address)).amount
        const lock_end = (await veCRV.locked(user.address)).end
        const unlock_time = getRoundedTimestamp(VECRV_LOCKING_TIME.add((await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp))
        if(locked_balance.eq(0)){
            await veCRV.connect(user).create_lock(lock_amount, unlock_time);
        } else if(locked_balance.lt(lock_amount)) {
            await veCRV.connect(user).increase_amount(lock_amount.sub(locked_balance));
            if(unlock_time.gt(lock_end)) await veCRV.connect(user).increase_unlock_time(unlock_time);
        } else if(unlock_time.gt(lock_end)) {
            await veCRV.connect(user).increase_unlock_time(unlock_time);
        }
    }

    before(async () => {
        [admin, chest, receiver, externalUser, creator, other_creator, delegator1, delegator2, delegator3] = await ethers.getSigners();

        delegators = [delegator1, delegator2, delegator3]

        wardenPledgeFactory = await ethers.getContractFactory("WardenPledge");

        CRV = IERC20__factory.connect(TOKEN_ADDRESS, provider);

        veCRV = IVotingEscrow__factory.connect(VOTING_ESCROW_ADDRESS, provider);

        delegationBoost = IBoostV2__factory.connect(BOOST_DELEGATION_ADDRESS, provider);

        rewardToken1 = IERC20__factory.connect(TOKENS[0], provider);
        rewardToken2 = IERC20__factory.connect(TOKENS[1], provider);

    })


    beforeEach(async () => {
        await resetFork();
        
        wardenPledge = (await wardenPledgeFactory.connect(admin).deploy(
            veCRV.address,
            delegationBoost.address,
            chest.address,
            min_target_votes
        )) as WardenPledge;
        await wardenPledge.deployed();

        await getERC20(admin, HOLDERS[0], rewardToken1, admin.address, AMOUNTS[0]);
        await getERC20(admin, HOLDERS[1], rewardToken2, admin.address, AMOUNTS[1]);

        await getERC20(admin, BIG_HOLDER, CRV, admin.address, crv_amount);

        for(let i = 0; i < delegators.length; i++){
            let delegator = delegators[i]
            await CRV.connect(admin).transfer(delegator.address, lock_amounts[i]);
            await CRV.connect(delegator).approve(veCRV.address, lock_amounts[i]);
            await resetVeLock(delegators[i], lock_amounts[i])
        }

    });

    it(' should be deployed & have correct parameters', async () => {
        expect(wardenPledge.address).to.properAddress

        const wardenPledge_votingEscrow = await wardenPledge.votingEscrow();
        const wardenPledge_delegationBoost = await wardenPledge.delegationBoost();
        const wardenPledge_chestAddress = await wardenPledge.chestAddress();
        const wardenPledge_protocalFeeRatio = await wardenPledge.protocalFeeRatio();
        const wardenPledge_minTargetVotes = await wardenPledge.minTargetVotes();

        expect(wardenPledge_votingEscrow).to.be.eq(veCRV.address);
        expect(wardenPledge_delegationBoost).to.be.eq(delegationBoost.address);
        expect(wardenPledge_chestAddress).to.be.eq(chest.address);
        expect(wardenPledge_protocalFeeRatio).to.be.eq(250);
        expect(wardenPledge_minTargetVotes).to.be.eq(min_target_votes);

        expect(await wardenPledge.UNIT()).to.be.eq(ethers.utils.parseEther('1'));
        expect(await wardenPledge.MAX_PCT()).to.be.eq(10000);
        expect(await wardenPledge.WEEK()).to.be.eq(604800);

        expect(await wardenPledge.pledgesIndex()).to.be.eq(0);

    });

    describe('addRewardToken', async () => {

        it(' should list the reward token correctly (& emit Event)', async () => {

            const add_tx = await wardenPledge.connect(admin).addRewardToken(rewardToken1.address, min_reward_per_vote[0])

            expect(await wardenPledge.minAmountRewardToken(rewardToken1.address)).to.be.eq(min_reward_per_vote[0])

            await expect(add_tx)
                .to.emit(wardenPledge, 'NewRewardToken')
                .withArgs(rewardToken1.address, min_reward_per_vote[0]);

        });

        it(' should allow to add other reward tokens', async () => {

            await wardenPledge.connect(admin).addRewardToken(rewardToken1.address, min_reward_per_vote[0])

            const add_tx = await wardenPledge.connect(admin).addRewardToken(rewardToken2.address, min_reward_per_vote[1])

            expect(await wardenPledge.minAmountRewardToken(rewardToken2.address)).to.be.eq(min_reward_per_vote[1])

            await expect(add_tx)
                .to.emit(wardenPledge, 'NewRewardToken')
                .withArgs(rewardToken2.address, min_reward_per_vote[1]);

        });

        it(' should not allow to list the same token twice', async () => {

            await wardenPledge.connect(admin).addRewardToken(rewardToken1.address, min_reward_per_vote[0])

            await expect(
                wardenPledge.connect(admin).addRewardToken(rewardToken1.address, min_reward_per_vote[0])
            ).to.be.revertedWith('AlreadyAllowedToken')

        });

        it(' should fail if given the address 0x0', async () => {

            await expect(
                wardenPledge.connect(admin).addRewardToken(ethers.constants.AddressZero, min_reward_per_vote[0])
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should fail if given a null amount', async () => {

            await expect(
                wardenPledge.connect(admin).addRewardToken(rewardToken1.address, 0)
            ).to.be.revertedWith('NullValue')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                wardenPledge.connect(creator).addRewardToken(rewardToken1.address, min_reward_per_vote[0])
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                wardenPledge.connect(receiver).addRewardToken(rewardToken1.address, min_reward_per_vote[0])
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

    });

    describe('addMultipleRewardToken', async () => {

        it(' should list the reward tokens correctly (& emit Event)', async () => {

            const add_tx = await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            expect(await wardenPledge.minAmountRewardToken(rewardToken1.address)).to.be.eq(min_reward_per_vote[0])
            expect(await wardenPledge.minAmountRewardToken(rewardToken2.address)).to.be.eq(min_reward_per_vote[1])

            await expect(add_tx)
                .to.emit(wardenPledge, 'NewRewardToken')
                .withArgs(rewardToken1.address, min_reward_per_vote[0]);

            await expect(add_tx)
                .to.emit(wardenPledge, 'NewRewardToken')
                .withArgs(rewardToken2.address, min_reward_per_vote[1]);

        });

        it(' should not allow to list the same token in the list', async () => {

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [rewardToken1.address, rewardToken1.address],
                    min_reward_per_vote
                )
            ).to.be.revertedWith('AlreadyAllowedToken')

        });

        it(' should not allow to list the same token twice', async () => {

            await wardenPledge.connect(admin).addRewardToken(rewardToken1.address, min_reward_per_vote[0])

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [rewardToken1.address, rewardToken2.address],
                    min_reward_per_vote
                )
            ).to.be.revertedWith('AlreadyAllowedToken')

        });

        it(' should fail if list are not equal', async () => {

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [rewardToken1.address],
                    min_reward_per_vote
                )
            ).to.be.revertedWith('InequalArraySizes')

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [rewardToken1.address, rewardToken2.address],
                    [min_reward_per_vote[0]]
                )
            ).to.be.revertedWith('InequalArraySizes')

        });

        it(' should fail if list is empty', async () => {

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [],
                    min_reward_per_vote
                )
            ).to.be.revertedWith('EmptyArray')

        });

        it(' should fail if given the address 0x0', async () => {

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [ethers.constants.AddressZero, rewardToken2.address],
                    min_reward_per_vote
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [rewardToken1.address, ethers.constants.AddressZero],
                    min_reward_per_vote
                )
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should fail if given a null amount', async () => {

            await expect(
                wardenPledge.connect(admin).addMultipleRewardToken(
                    [rewardToken1.address, rewardToken2.address],
                    [min_reward_per_vote[0], 0]
                )
            ).to.be.revertedWith('NullValue')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                wardenPledge.connect(creator).addMultipleRewardToken(
                    [rewardToken1.address, rewardToken2.address],
                    min_reward_per_vote
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                wardenPledge.connect(receiver).addMultipleRewardToken(
                    [rewardToken1.address, rewardToken2.address],
                    min_reward_per_vote
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

    });

    describe('updateRewardToken', async () => {

        const new_min_reward_per_vote = [
            ethers.utils.parseEther('0.0000000025'),
            ethers.utils.parseEther('0.000000005')
        ]

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

        })

        it(' should update the parameter correctly (& emit Event)', async () => {

            const update_tx = await wardenPledge.connect(admin).updateRewardToken(rewardToken1.address, new_min_reward_per_vote[0])

            expect(await wardenPledge.minAmountRewardToken(rewardToken1.address)).to.be.eq(new_min_reward_per_vote[0])

            await expect(update_tx)
                .to.emit(wardenPledge, 'UpdateRewardToken')
                .withArgs(rewardToken1.address, new_min_reward_per_vote[0]);

        });

        it(' should only work for added reward tokens', async () => {

            await expect(
                wardenPledge.connect(admin).updateRewardToken(CRV.address, new_min_reward_per_vote[0])
            ).to.be.revertedWith('NotAllowedToken')

        });

        it(' should fail if the token is removed', async () => {

            await wardenPledge.connect(admin).removeRewardToken(rewardToken1.address)

            await expect(
                wardenPledge.connect(admin).updateRewardToken(rewardToken1.address, new_min_reward_per_vote[0])
            ).to.be.revertedWith('NotAllowedToken')

        });

        it(' should fail if given the address 0x0', async () => {

            await expect(
                wardenPledge.connect(admin).updateRewardToken(ethers.constants.AddressZero, new_min_reward_per_vote[0])
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should fail if given null amount', async () => {

            await expect(
                wardenPledge.connect(admin).updateRewardToken(rewardToken1.address, 0)
            ).to.be.revertedWith('InvalidValue')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                wardenPledge.connect(creator).updateRewardToken(rewardToken1.address, new_min_reward_per_vote[0])
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                wardenPledge.connect(receiver).updateRewardToken(rewardToken1.address, new_min_reward_per_vote[0])
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

    });

    describe('removeRewardToken', async () => {

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

        })

        it(' should remove the token correctly (& emit Event)', async () => {

            const remove_tx = await wardenPledge.connect(admin).removeRewardToken(rewardToken1.address)

            expect(await wardenPledge.minAmountRewardToken(rewardToken1.address)).to.be.eq(0)

            await expect(remove_tx)
                .to.emit(wardenPledge, 'RemoveRewardToken')
                .withArgs(rewardToken1.address);

        });

        it(' should fail if token is not already listed', async () => {

            await expect(
                wardenPledge.connect(admin).removeRewardToken(CRV.address)
            ).to.be.revertedWith('NotAllowedToken')

        });

        it(' should fail if already removed', async () => {

            await wardenPledge.connect(admin).removeRewardToken(rewardToken1.address)

            await expect(
                wardenPledge.connect(admin).removeRewardToken(rewardToken1.address)
            ).to.be.revertedWith('NotAllowedToken')

        });

        it(' should fail if given the address 0x0', async () => {

            await expect(
                wardenPledge.connect(admin).removeRewardToken(ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                wardenPledge.connect(creator).removeRewardToken(rewardToken1.address)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                wardenPledge.connect(receiver).removeRewardToken(rewardToken1.address)
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

    });

    describe('createPledge', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        const target_votes2 = ethers.utils.parseEther("1200000")
        const reward_per_vote2 = ethers.utils.parseEther('0.00000007')
        const week_duration2 = BigNumber.from(5)

        let end_timestamp2: BigNumber
        let max_total_reward_amount2: BigNumber
        let max_fee_amount2: BigNumber

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount))

        })

        it(' should create the Pledge correctly (& emit Event)', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const expected_id = await wardenPledge.pledgesIndex();

            const create_tx = await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration = end_timestamp.sub(tx_timestamp)
            const real_total_reward_amount = target_votes.mul(reward_per_vote).mul(real_duration).div(UNIT)

            expect(await wardenPledge.pledgesIndex()).to.be.eq(expected_id.add(1));

            expect(await wardenPledge.pledgeAvailableRewardAmounts(expected_id)).to.be.eq(real_total_reward_amount);

            const pledge_data = await wardenPledge.pledges(expected_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes);
            expect(pledge_data.votesDifference).to.be.eq(target_votes);
            expect(pledge_data.rewardPerVote).to.be.eq(reward_per_vote);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken1.address);
            expect(pledge_data.endTimestamp).to.be.eq(end_timestamp);
            expect(pledge_data.closed).to.be.false;

            expect(await wardenPledge.pledgeOwner(expected_id)).to.be.eq(creator.address);

            const creator_pledges = await wardenPledge.getUserPledges(creator.address)

            expect(creator_pledges[creator_pledges.length - 1]).to.be.eq(expected_id);

            const all_pledges = await wardenPledge.getAllPledges()

            const last_pledge = all_pledges[all_pledges.length - 1]
            expect(last_pledge.targetVotes).to.be.eq(pledge_data.targetVotes);
            expect(last_pledge.rewardPerVote).to.be.eq(pledge_data.rewardPerVote);
            expect(last_pledge.receiver).to.be.eq(pledge_data.receiver);
            expect(last_pledge.rewardToken).to.be.eq(pledge_data.rewardToken);
            expect(last_pledge.endTimestamp).to.be.eq(pledge_data.endTimestamp);
            expect(last_pledge.closed).to.be.eq(pledge_data.closed);

            await expect(create_tx)
                .to.emit(wardenPledge, 'NewPledge')
                .withArgs(
                    creator.address,
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp
                );

        });

        it(' should do the correct Transfers', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const create_tx = await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration = end_timestamp.sub(tx_timestamp)
            const real_total_reward_amount = target_votes.mul(reward_per_vote).mul(real_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            const real_fee_amount = real_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_total_reward_amount))

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    wardenPledge.address,
                    real_total_reward_amount
                );

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    chest.address,
                    real_fee_amount
                );

        });

        it(' should set the correct voteDifference if the receiver already has veToken balance', async () => {

            const lock_amount = ethers.utils.parseEther('12500')

            await CRV.connect(admin).transfer(receiver.address, lock_amount);
            await CRV.connect(receiver).approve(veCRV.address, lock_amount);

            const unlock_time = getRoundedTimestamp(VECRV_LOCKING_TIME.add((await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp))
            await veCRV.connect(receiver).create_lock(lock_amount, unlock_time);
            
            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const expected_id = await wardenPledge.pledgesIndex();

            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const create_tx = await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const tx_block = (await create_tx).blockNumber
            const tx_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receiver_balance = await veCRV.balanceOf(receiver.address, { blockTag: tx_block })

            const real_votes_difference = target_votes.sub(receiver_balance)
            const real_duration = end_timestamp.sub(tx_timestamp)
            const real_total_reward_amount = real_votes_difference.mul(reward_per_vote).mul(real_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            const real_fee_amount = real_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            expect(await wardenPledge.pledgesIndex()).to.be.eq(expected_id.add(1));

            expect(await wardenPledge.pledgeAvailableRewardAmounts(expected_id)).to.be.eq(real_total_reward_amount);

            const pledge_data = await wardenPledge.pledges(expected_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes);
            expect(pledge_data.votesDifference).to.be.eq(real_votes_difference);
            expect(pledge_data.rewardPerVote).to.be.eq(reward_per_vote);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken1.address);
            expect(pledge_data.endTimestamp).to.be.eq(end_timestamp);
            expect(pledge_data.closed).to.be.false;

            expect(await wardenPledge.pledgeOwner(expected_id)).to.be.eq(creator.address);

            const creator_pledges = await wardenPledge.getUserPledges(creator.address)

            expect(creator_pledges[creator_pledges.length - 1]).to.be.eq(expected_id);

            const all_pledges = await wardenPledge.getAllPledges()

            const last_pledge = all_pledges[all_pledges.length - 1]
            expect(last_pledge.targetVotes).to.be.eq(pledge_data.targetVotes);
            expect(last_pledge.votesDifference).to.be.eq(pledge_data.votesDifference);
            expect(last_pledge.rewardPerVote).to.be.eq(pledge_data.rewardPerVote);
            expect(last_pledge.receiver).to.be.eq(pledge_data.receiver);
            expect(last_pledge.rewardToken).to.be.eq(pledge_data.rewardToken);
            expect(last_pledge.endTimestamp).to.be.eq(pledge_data.endTimestamp);
            expect(last_pledge.closed).to.be.eq(pledge_data.closed);

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_total_reward_amount))

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    wardenPledge.address,
                    real_total_reward_amount
                );

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    chest.address,
                    real_fee_amount
                );

            await expect(create_tx)
                .to.emit(wardenPledge, 'NewPledge')
                .withArgs(
                    creator.address,
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp
                );

        });

        it(' should allow the same creator to create with a different reward token', async () => {
            
            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp2 = current_ts.add(WEEK.mul(week_duration2))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp2 = getRoundedTimestamp(end_timestamp2)
            const duration2 = end_timestamp2.sub(current_ts)
            max_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(duration2).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount2 = max_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            await rewardToken2.connect(admin).transfer(creator.address, max_total_reward_amount2.add(max_fee_amount2))

            await rewardToken2.connect(creator).approve(wardenPledge.address, max_total_reward_amount2.add(max_fee_amount2))

            const old_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)

            const expected_id = await wardenPledge.pledgesIndex();

            const create_tx = await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken2.address,
                target_votes2,
                reward_per_vote2,
                end_timestamp2,
                max_total_reward_amount2,
                max_fee_amount2
            )

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration2 = end_timestamp2.sub(tx_timestamp)
            const real_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(real_duration2).div(UNIT)
            const real_fee_amount2 = real_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            expect(await wardenPledge.pledgesIndex()).to.be.eq(expected_id.add(1));

            expect(await wardenPledge.pledgeAvailableRewardAmounts(expected_id)).to.be.eq(real_total_reward_amount2);

            const pledge_data = await wardenPledge.pledges(expected_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes2);
            expect(pledge_data.rewardPerVote).to.be.eq(reward_per_vote2);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken2.address);
            expect(pledge_data.endTimestamp).to.be.eq(end_timestamp2);
            expect(pledge_data.closed).to.be.false;

            expect(await wardenPledge.pledgeOwner(expected_id)).to.be.eq(creator.address);

            const creator_pledges = await wardenPledge.getUserPledges(creator.address)

            expect(creator_pledges[creator_pledges.length - 1]).to.be.eq(expected_id);

            const new_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_total_reward_amount2))

            await expect(create_tx)
                .to.emit(wardenPledge, 'NewPledge')
                .withArgs(
                    creator.address,
                    receiver.address,
                    rewardToken2.address,
                    target_votes2,
                    reward_per_vote2,
                    end_timestamp2
                );

            await expect(create_tx)
                .to.emit(rewardToken2, 'Transfer')
                .withArgs(
                    creator.address,
                    wardenPledge.address,
                    real_total_reward_amount2
                );

            await expect(create_tx)
                .to.emit(rewardToken2, 'Transfer')
                .withArgs(
                    creator.address,
                    chest.address,
                    real_fee_amount2
                );

        });

        it(' should allow a different creator to create with a different reward token', async () => {
            
            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp2 = current_ts.add(WEEK.mul(week_duration2))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp2 = getRoundedTimestamp(end_timestamp2)
            const duration2 = end_timestamp2.sub(current_ts)
            max_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(duration2).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount2 = max_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            await rewardToken2.connect(admin).transfer(other_creator.address, max_total_reward_amount2.add(max_fee_amount2))

            await rewardToken2.connect(other_creator).approve(wardenPledge.address, max_total_reward_amount2.add(max_fee_amount2))

            const old_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)

            const expected_id = await wardenPledge.pledgesIndex();

            const create_tx = await wardenPledge.connect(other_creator).createPledge(
                receiver.address,
                rewardToken2.address,
                target_votes2,
                reward_per_vote2,
                end_timestamp2,
                max_total_reward_amount2,
                max_fee_amount2
            )

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration2 = end_timestamp2.sub(tx_timestamp)
            const real_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(real_duration2).div(UNIT)
            const real_fee_amount2 = real_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            expect(await wardenPledge.pledgesIndex()).to.be.eq(expected_id.add(1));

            expect(await wardenPledge.pledgeAvailableRewardAmounts(expected_id)).to.be.eq(real_total_reward_amount2);

            const pledge_data = await wardenPledge.pledges(expected_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes2);
            expect(pledge_data.rewardPerVote).to.be.eq(reward_per_vote2);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken2.address);
            expect(pledge_data.endTimestamp).to.be.eq(end_timestamp2);
            expect(pledge_data.closed).to.be.false;

            expect(await wardenPledge.pledgeOwner(expected_id)).to.be.eq(other_creator.address);

            const creator_pledges = await wardenPledge.getUserPledges(other_creator.address)

            expect(creator_pledges[creator_pledges.length - 1]).to.be.eq(expected_id);

            const new_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_total_reward_amount2))

            await expect(create_tx)
                .to.emit(wardenPledge, 'NewPledge')
                .withArgs(
                    other_creator.address,
                    receiver.address,
                    rewardToken2.address,
                    target_votes2,
                    reward_per_vote2,
                    end_timestamp2
                );

            await expect(create_tx)
                .to.emit(rewardToken2, 'Transfer')
                .withArgs(
                    other_creator.address,
                    wardenPledge.address,
                    real_total_reward_amount2
                );

            await expect(create_tx)
                .to.emit(rewardToken2, 'Transfer')
                .withArgs(
                    other_creator.address,
                    chest.address,
                    real_fee_amount2
                );

        });

        it(' should allow a different creator to create with the same reward token', async () => {
            
            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp2 = current_ts.add(WEEK.mul(week_duration2))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp2 = getRoundedTimestamp(end_timestamp2)
            const duration2 = end_timestamp2.sub(current_ts)
            max_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(duration2).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount2 = max_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(other_creator.address, max_total_reward_amount2.add(max_fee_amount2))

            await rewardToken1.connect(other_creator).approve(wardenPledge.address, max_total_reward_amount2.add(max_fee_amount2))

            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const expected_id = await wardenPledge.pledgesIndex();

            const create_tx = await wardenPledge.connect(other_creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes2,
                reward_per_vote2,
                end_timestamp2,
                max_total_reward_amount2,
                max_fee_amount2
            )

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration2 = end_timestamp2.sub(tx_timestamp)
            const real_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(real_duration2).div(UNIT)
            const real_fee_amount2 = real_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            expect(await wardenPledge.pledgesIndex()).to.be.eq(expected_id.add(1));

            expect(await wardenPledge.pledgeAvailableRewardAmounts(expected_id)).to.be.eq(real_total_reward_amount2);

            const pledge_data = await wardenPledge.pledges(expected_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes2);
            expect(pledge_data.rewardPerVote).to.be.eq(reward_per_vote2);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken1.address);
            expect(pledge_data.endTimestamp).to.be.eq(end_timestamp2);
            expect(pledge_data.closed).to.be.false;

            expect(await wardenPledge.pledgeOwner(expected_id)).to.be.eq(other_creator.address);

            const creator_pledges = await wardenPledge.getUserPledges(other_creator.address)

            expect(creator_pledges[creator_pledges.length - 1]).to.be.eq(expected_id);

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_total_reward_amount2))

            await expect(create_tx)
                .to.emit(wardenPledge, 'NewPledge')
                .withArgs(
                    other_creator.address,
                    receiver.address,
                    rewardToken1.address,
                    target_votes2,
                    reward_per_vote2,
                    end_timestamp2
                );

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    other_creator.address,
                    wardenPledge.address,
                    real_total_reward_amount2
                );

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    other_creator.address,
                    chest.address,
                    real_fee_amount2
                );

        });

        it(' should allow the same creator to create with the same reward token', async () => {
            
            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp2 = current_ts.add(WEEK.mul(week_duration2))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp2 = getRoundedTimestamp(end_timestamp2)
            const duration2 = end_timestamp2.sub(current_ts)
            max_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(duration2).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount2 = max_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount2.add(max_fee_amount2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount2.add(max_fee_amount2))

            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const expected_id = await wardenPledge.pledgesIndex();

            const create_tx = await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes2,
                reward_per_vote2,
                end_timestamp2,
                max_total_reward_amount2,
                max_fee_amount2
            )

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration2 = end_timestamp2.sub(tx_timestamp)
            const real_total_reward_amount2 = target_votes2.mul(reward_per_vote2).mul(real_duration2).div(UNIT)
            const real_fee_amount2 = real_total_reward_amount2.mul(fee_ratio).div(MAX_BPS)

            expect(await wardenPledge.pledgesIndex()).to.be.eq(expected_id.add(1));

            expect(await wardenPledge.pledgeAvailableRewardAmounts(expected_id)).to.be.eq(real_total_reward_amount2);

            const pledge_data = await wardenPledge.pledges(expected_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes2);
            expect(pledge_data.rewardPerVote).to.be.eq(reward_per_vote2);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken1.address);
            expect(pledge_data.endTimestamp).to.be.eq(end_timestamp2);
            expect(pledge_data.closed).to.be.false;

            expect(await wardenPledge.pledgeOwner(expected_id)).to.be.eq(creator.address);

            const creator_pledges = await wardenPledge.getUserPledges(creator.address)

            expect(creator_pledges[creator_pledges.length - 1]).to.be.eq(expected_id);

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_total_reward_amount2))

            await expect(create_tx)
                .to.emit(wardenPledge, 'NewPledge')
                .withArgs(
                    creator.address,
                    receiver.address,
                    rewardToken1.address,
                    target_votes2,
                    reward_per_vote2,
                    end_timestamp2
                );

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    wardenPledge.address,
                    real_total_reward_amount2
                );

            await expect(create_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    chest.address,
                    real_fee_amount2
                );

        });

        it(' should fail if given address 0x0', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            await expect(
                wardenPledge.connect(creator).createPledge(
                    ethers.constants.AddressZero,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    ethers.constants.AddressZero,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should fail if the target vote amount is under the required minimum', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const invalid_target_votes = min_target_votes.div(2)

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    invalid_target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('TargetVoteUnderMin')

        });

        it(' should fail if the reward token given is not listed as allowed', async () => {

            await CRV.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    CRV.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('TokenNotWhitelisted')

        });

        it(' should fail if the reward per vote is under the minimum required', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const invalid_reward_per_vote = min_reward_per_vote[0].div(2)

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    invalid_reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('RewardPerVoteTooLow')

        });

        it(' should fail if the given timestamp is invalid', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const not_rounded_end_timestamp = current_ts.add(WEEK.mul(week_duration))

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    not_rounded_end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('InvalidEndTimestamp')

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    0,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('NullEndTimestamp')

        });

        it(' should fail if the duration is too small', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(1))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('DurationTooShort')

        });

        it(' should fail if the max total rewards does not cover the given parameters', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            const invalid_max_total_reward_amount = target_votes.div(2).mul(reward_per_vote).mul(duration).div(UNIT)

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    invalid_max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith('IncorrectMaxTotalRewardAmount')

        });

        it(' should fail if the max fee amount does not cover the required fees', async () => {

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount.div(2)
                )
            ).to.be.revertedWith('IncorrectMaxFeeAmount')

        });

    });

    describe('extendPledge', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        const added_week_duration = BigNumber.from(2)
        let new_end_timestamp: BigNumber

        let added_max_total_reward_amount: BigNumber
        let added_max_fee_amount: BigNumber

        let pledge_id: BigNumber

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            pledge_id = await wardenPledge.pledgesIndex();

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            await advanceTime(WEEK.mul(3).toNumber())

        })

        it(' should extend the duration correctly (& emit Event)', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            const old_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)

            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            const extend_tx = await wardenPledge.connect(creator).extendPledge(
                pledge_id,
                new_end_timestamp,
                added_max_total_reward_amount,
                added_max_fee_amount
            )

            const real_added_duration = new_end_timestamp.sub(end_timestamp)
            const real_added_total_reward_amount = target_votes.mul(reward_per_vote).mul(real_added_duration).div(UNIT)
            const real_added_fee_amount = real_added_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            const pledge_data = await wardenPledge.pledges(pledge_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes);
            expect(pledge_data.votesDifference).to.be.eq(pledge_vote_diff);
            expect(pledge_data.rewardPerVote).to.be.eq(reward_per_vote);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken1.address);
            expect(pledge_data.endTimestamp).to.be.eq(new_end_timestamp);
            expect(pledge_data.closed).to.be.false;

            const new_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)

            expect(new_remaining_rewards).to.be.eq(old_remaining_rewards.add(real_added_total_reward_amount))

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_added_total_reward_amount))

            await expect(extend_tx)
                .to.emit(wardenPledge, 'ExtendPledgeDuration')
                .withArgs(pledge_id, end_timestamp, new_end_timestamp);

            await expect(extend_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    wardenPledge.address,
                    real_added_total_reward_amount
                );

            await expect(extend_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    chest.address,
                    real_added_fee_amount
                );

        });

        it(' should fail if the pledge ID is invalid', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id.add(3),
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('InvalidPledgeID')

        });

        it(' should fail if caller is not the Pledge creator', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(other_creator).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('NotPledgeCreator')

            await expect(
                wardenPledge.connect(receiver).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('NotPledgeCreator')

            await expect(
                wardenPledge.connect(admin).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('NotPledgeCreator')

        });

        it(' should fail if the Pledge was closed', async () => {

            await wardenPledge.connect(creator).closePledge(pledge_id, creator.address)

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('PledgeClosed')

        });

        it(' should fail if Pledge is already expired', async () => {

            await advanceTime(WEEK.mul(week_duration).toNumber())

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('ExpiredPledge')

        });

        it(' should fail if the new end timestamp is less than the previous one', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    end_timestamp.sub(WEEK),
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('InvalidEndTimestamp')

        });

        it(' should fail if given an invalid timestamp', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            const invalid_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration)).sub(150)
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    invalid_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('InvalidEndTimestamp')

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    0,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('NullEndTimestamp')

        });

        it(' should fail if the added duration is too small', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.div(2))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('DurationTooShort')

        });

        it(' should fail if the given max total rewards does not cover the needed added rewards', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.div(2).mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('IncorrectMaxTotalRewardAmount')

        });

        it(' should fail if the max fees is not enough', async () => {

            new_end_timestamp = end_timestamp.add(WEEK.mul(added_week_duration))
            new_end_timestamp = getRoundedTimestamp(new_end_timestamp)
            const added_duration = new_end_timestamp.sub(end_timestamp)
            const pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(reward_per_vote).mul(added_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await expect(
                wardenPledge.connect(creator).extendPledge(
                    pledge_id,
                    new_end_timestamp,
                    added_max_total_reward_amount,
                    added_max_fee_amount.div(2)
                )
            ).to.be.revertedWith('IncorrectMaxFeeAmount')

        });

    });

    describe('increasePledgeRewardPerVote', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        const new_reward_per_vote = ethers.utils.parseEther("0.000000025")

        let pledge_vote_diff: BigNumber

        let added_max_total_reward_amount: BigNumber
        let added_max_fee_amount: BigNumber

        let pledge_id: BigNumber

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            pledge_id = await wardenPledge.pledgesIndex();

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            await advanceTime(WEEK.mul(3).toNumber())

            const new_current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const reamining_duration = end_timestamp.sub(new_current_ts)
            pledge_vote_diff = (await wardenPledge.pledges(pledge_id)).votesDifference
            added_max_total_reward_amount = pledge_vote_diff.mul(new_reward_per_vote.sub(reward_per_vote)).mul(reamining_duration).div(UNIT)
            added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

        })

        it(' should increase the Pledge targetVote parameter (& emit Event)', async () => {

            const old_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)

            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const increase_tx = await wardenPledge.connect(creator).increasePledgeRewardPerVote(
                pledge_id,
                new_reward_per_vote,
                added_max_total_reward_amount,
                added_max_fee_amount
            )

            const tx_timestamp = (await ethers.provider.getBlock((await increase_tx).blockNumber || 0)).timestamp
            const real_remaining_duration = end_timestamp.sub(tx_timestamp)
            const diff_rewards_per_vote = new_reward_per_vote.sub(reward_per_vote)
            const real_added_total_reward_amount = target_votes.mul(diff_rewards_per_vote).mul(real_remaining_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            const real_added_fee_amount = real_added_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            const pledge_data = await wardenPledge.pledges(pledge_id)

            expect(pledge_data.targetVotes).to.be.eq(target_votes);
            expect(pledge_data.votesDifference).to.be.eq(pledge_vote_diff);
            expect(pledge_data.rewardPerVote).to.be.eq(new_reward_per_vote);
            expect(pledge_data.receiver).to.be.eq(receiver.address);
            expect(pledge_data.rewardToken).to.be.eq(rewardToken1.address);
            expect(pledge_data.endTimestamp).to.be.eq(end_timestamp);
            expect(pledge_data.closed).to.be.false;

            const new_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)

            expect(new_remaining_rewards).to.be.eq(old_remaining_rewards.add(real_added_total_reward_amount))

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.add(real_added_total_reward_amount))

            await expect(increase_tx)
                .to.emit(wardenPledge, 'IncreasePledgeRewardPerVote')
                .withArgs(pledge_id, reward_per_vote, new_reward_per_vote);

            await expect(increase_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    wardenPledge.address,
                    real_added_total_reward_amount
                );

            await expect(increase_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(
                    creator.address,
                    chest.address,
                    real_added_fee_amount
                );

        });

        it(' should fail if the pledge ID is invalid', async () => {

            await expect(
                wardenPledge.connect(creator).increasePledgeRewardPerVote(
                    pledge_id.add(3),
                    new_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('InvalidPledgeID')

        });

        it(' should fail if caller is not the Pledge creator', async () => {

            await expect(
                wardenPledge.connect(other_creator).increasePledgeRewardPerVote(
                    pledge_id,
                    new_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('NotPledgeCreator')

            await expect(
                wardenPledge.connect(receiver).increasePledgeRewardPerVote(
                    pledge_id,
                    new_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('NotPledgeCreator')

            await expect(
                wardenPledge.connect(admin).increasePledgeRewardPerVote(
                    pledge_id,
                    new_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('NotPledgeCreator')

        });

        it(' should fail if the Pledge was closed', async () => {

            await wardenPledge.connect(creator).closePledge(pledge_id, creator.address)

            await expect(
                wardenPledge.connect(creator).increasePledgeRewardPerVote(
                    pledge_id,
                    new_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('PledgeClosed')

        });

        it(' should fail if Pledge is already expired', async () => {

            await advanceTime(WEEK.mul(week_duration).toNumber())

            await expect(
                wardenPledge.connect(creator).increasePledgeRewardPerVote(
                    pledge_id,
                    new_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('ExpiredPledge')

        });

        it(' should fail if the new reward per vote is lower than previous one', async () => {

            const smaller_reward_per_vote = ethers.utils.parseEther('0.00000001')

            await expect(
                wardenPledge.connect(creator).increasePledgeRewardPerVote(
                    pledge_id,
                    smaller_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount
                )
            ).to.be.revertedWith('RewardsPerVotesTooLow')

        });

        it(' should fail if the given max total rewards does not cover the needed added rewards', async () => {

            await expect(
                wardenPledge.connect(creator).increasePledgeRewardPerVote(
                    pledge_id,
                    new_reward_per_vote,
                    added_max_total_reward_amount.div(2),
                    added_max_fee_amount
                )
            ).to.be.revertedWith('IncorrectMaxTotalRewardAmount')

        });

        it(' should fail if the max fees is not enough', async () => {

            await expect(
                wardenPledge.connect(creator).increasePledgeRewardPerVote(
                    pledge_id,
                    new_reward_per_vote,
                    added_max_total_reward_amount,
                    added_max_fee_amount.div(2)
                )
            ).to.be.revertedWith('IncorrectMaxFeeAmount')

        });

    });

    describe('pledge', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        let pledge_id: BigNumber

        const deleg_amount1 = ethers.utils.parseEther("350000")
        const boost_week_duration1 = BigNumber.from(3) 

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            pledge_id = await wardenPledge.pledgesIndex();

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            await advanceTime(WEEK.mul(1).toNumber())

        })

        it(' should delegate the correct amount for the given duration to the correct address (& emit Event) ', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            const pledge_tx = await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)

            const tx_timestamp = (await ethers.provider.getBlock((await pledge_tx).blockNumber || 0)).timestamp
            const boost_duration = boost_end_timestamp.sub(tx_timestamp)

            const boost_slope = deleg_amount1.div(boost_duration)
            const boost_bias = boost_duration.mul(boost_slope)

            const tx_block = (await pledge_tx).blockNumber
            expect(await delegationBoost.delegated_balance(delegator1.address, { blockTag: tx_block })).to.be.eq(boost_bias)
            expect(await delegationBoost.received_balance(receiver.address, { blockTag: tx_block })).to.be.eq(boost_bias)

            await expect(pledge_tx)
                .to.emit(delegationBoost, 'Boost')
                .withArgs(delegator1.address, receiver.address, boost_bias, boost_slope, tx_timestamp);

            await expect(pledge_tx)
                .to.emit(wardenPledge, 'Pledged')
                .withArgs(pledge_id, delegator1.address, deleg_amount1, boost_end_timestamp);

            await advanceTime(WEEK.mul(boost_week_duration1.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)

        });

        it(' should give the correct amount of rewards to the user', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            const old_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const pledge_tx = await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)

            const tx_timestamp = (await ethers.provider.getBlock((await pledge_tx).blockNumber || 0)).timestamp
            const boost_duration = boost_end_timestamp.sub(tx_timestamp)

            const boost_slope = deleg_amount1.div(boost_duration)
            const boost_bias = boost_duration.mul(boost_slope)

            // total amount of veBoost delegated (sum for each second of the Boost duration)
            const boost_total_delegated_amount = boost_bias.mul(boost_duration).add(boost_bias).div(2)
            const expected_boost_rewards = boost_total_delegated_amount.mul(reward_per_vote).div(UNIT)

            const new_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const new_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            expect(new_pledge_remaining_rewards).to.be.eq(old_pledge_remaining_rewards.sub(expected_boost_rewards))
            expect(new_delegator_balance).to.be.eq(old_delegator_balance.add(expected_boost_rewards))
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(expected_boost_rewards))

            await expect(pledge_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, delegator1.address, expected_boost_rewards);

            await advanceTime(WEEK.mul(boost_week_duration1.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)

        });

        it(' should allow another user to to get rewards from the same Pledge', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)

            await advanceTime(WEEK.mul(2).toNumber())

            const deleg_amount2 = ethers.utils.parseEther("275000")
            const boost_week_duration2 = BigNumber.from(2)
            
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const new_current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp2 = getRoundedTimestamp(new_current_ts.add(WEEK.mul(boost_week_duration2)))

            const old_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_delegator_balance = await rewardToken1.balanceOf(delegator2.address)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const pledge_tx = await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            const tx_timestamp = (await ethers.provider.getBlock((await pledge_tx).blockNumber || 0)).timestamp
            const boost_duration2 = boost_end_timestamp2.sub(tx_timestamp)

            const boost_slope = deleg_amount2.div(boost_duration2)
            const boost_bias = boost_duration2.mul(boost_slope)

            const tx_block = (await pledge_tx).blockNumber
            expect(await delegationBoost.delegated_balance(delegator2.address, { blockTag: tx_block })).to.be.eq(boost_bias)

            // total amount of veBoost delegated (sum for each second of the Boost duration)
            const boost_total_delegated_amount = boost_bias.mul(boost_duration2).add(boost_bias).div(2)
            const expected_boost_rewards = boost_total_delegated_amount.mul(reward_per_vote).div(UNIT)

            const new_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const new_delegator_balance = await rewardToken1.balanceOf(delegator2.address)
            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            expect(new_pledge_remaining_rewards).to.be.eq(old_pledge_remaining_rewards.sub(expected_boost_rewards))
            expect(new_delegator_balance).to.be.eq(old_delegator_balance.add(expected_boost_rewards))
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(expected_boost_rewards))

            await expect(pledge_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, delegator2.address, expected_boost_rewards);

            await expect(pledge_tx)
                .to.emit(delegationBoost, 'Boost')
                .withArgs(delegator2.address, receiver.address, boost_bias, boost_slope, tx_timestamp);

            await expect(pledge_tx)
                .to.emit(wardenPledge, 'Pledged')
                .withArgs(pledge_id, delegator2.address, deleg_amount2, boost_end_timestamp2);

            await advanceTime(WEEK.mul(boost_week_duration1.add(2)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should allow the same user to get rewards from another Pledge', async () => {

            let current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken2.connect(admin).transfer(other_creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken2.connect(other_creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const pledge_id2 = await wardenPledge.pledgesIndex();

            await wardenPledge.connect(other_creator).createPledge(
                receiver.address,
                rewardToken2.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)

            await advanceTime(WEEK.mul(2).toNumber())

            const deleg_amount2 = ethers.utils.parseEther("150000")
            const boost_week_duration2 = BigNumber.from(4)
            
            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount2)

            const new_current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp2 = getRoundedTimestamp(new_current_ts.add(WEEK.mul(boost_week_duration2)))

            const old_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id2)
            const old_delegator_balance = await rewardToken2.balanceOf(delegator1.address)
            const old_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)

            const pledge_tx = await wardenPledge.connect(delegator1).pledge(pledge_id2, deleg_amount2, boost_end_timestamp2)

            const tx_timestamp = (await ethers.provider.getBlock((await pledge_tx).blockNumber || 0)).timestamp
            const boost_duration2 = boost_end_timestamp2.sub(tx_timestamp)

            const boost_slope = deleg_amount2.div(boost_duration2)
            const boost_bias = boost_duration2.mul(boost_slope)

            // total amount of veBoost delegated (sum for each second of the Boost duration)
            const boost_total_delegated_amount = boost_bias.mul(boost_duration2).add(boost_bias).div(2)
            const expected_boost_rewards = boost_total_delegated_amount.mul(reward_per_vote).div(UNIT)

            const new_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id2)
            const new_delegator_balance = await rewardToken2.balanceOf(delegator1.address)
            const new_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)

            expect(new_pledge_remaining_rewards).to.be.eq(old_pledge_remaining_rewards.sub(expected_boost_rewards))
            expect(new_delegator_balance).to.be.eq(old_delegator_balance.add(expected_boost_rewards))
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(expected_boost_rewards))

            await expect(pledge_tx)
                .to.emit(rewardToken2, 'Transfer')
                .withArgs(wardenPledge.address, delegator1.address, expected_boost_rewards);

            await expect(pledge_tx)
                .to.emit(delegationBoost, 'Boost')
                .withArgs(delegator1.address, receiver.address, boost_bias, boost_slope, tx_timestamp);

            await expect(pledge_tx)
                .to.emit(wardenPledge, 'Pledged')
                .withArgs(pledge_id2, delegator1.address, deleg_amount2, boost_end_timestamp2);

            await advanceTime(WEEK.mul(boost_week_duration2.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)

        });

        it(' should delegate until the Pledge end if given 0 as end timestamp & give the correct rewards', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const pledge_end_timestamp = (await wardenPledge.pledges(pledge_id)).endTimestamp

            const old_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const pledge_tx = await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, 0)

            const tx_timestamp = (await ethers.provider.getBlock((await pledge_tx).blockNumber || 0)).timestamp
            const boost_duration = pledge_end_timestamp.sub(tx_timestamp)

            const boost_slope = deleg_amount1.div(boost_duration)
            const boost_bias = boost_duration.mul(boost_slope)

            // total amount of veBoost delegated (sum for each second of the Boost duration)
            const boost_total_delegated_amount = boost_bias.mul(boost_duration).add(boost_bias).div(2)
            const expected_boost_rewards = boost_total_delegated_amount.mul(reward_per_vote).div(UNIT)

            const tx_block = (await pledge_tx).blockNumber
            expect(await delegationBoost.delegated_balance(delegator1.address, { blockTag: tx_block })).to.be.eq(boost_bias)
            expect(await delegationBoost.received_balance(receiver.address, { blockTag: tx_block })).to.be.eq(boost_bias)

            const new_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const new_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            expect(new_pledge_remaining_rewards).to.be.eq(old_pledge_remaining_rewards.sub(expected_boost_rewards))
            expect(new_delegator_balance).to.be.eq(old_delegator_balance.add(expected_boost_rewards))
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(expected_boost_rewards))

            await expect(pledge_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, delegator1.address, expected_boost_rewards);

            await expect(pledge_tx)
                .to.emit(delegationBoost, 'Boost')
                .withArgs(delegator1.address, receiver.address, boost_bias, boost_slope, tx_timestamp);

            await expect(pledge_tx)
                .to.emit(wardenPledge, 'Pledged')
                .withArgs(pledge_id, delegator1.address, deleg_amount1, pledge_end_timestamp);

            await advanceTime(WEEK.mul(boost_week_duration1.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)

        });

        it(' should give the correct amount of rewards to the user if Pledge rewards per vote were increased', async () => {

            const new_reward_per_vote = ethers.utils.parseEther("0.000000025")

            const increase_current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const reamining_duration = end_timestamp.sub(increase_current_ts)
            const added_max_total_reward_amount = target_votes.mul(new_reward_per_vote.sub(reward_per_vote)).mul(reamining_duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            const added_max_fee_amount = added_max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(creator).approve(wardenPledge.address, added_max_total_reward_amount.add(added_max_fee_amount))

            await wardenPledge.connect(creator).increasePledgeRewardPerVote(
                pledge_id,
                new_reward_per_vote,
                added_max_total_reward_amount,
                added_max_fee_amount
            )

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            const old_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const pledge_tx = await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)

            const tx_timestamp = (await ethers.provider.getBlock((await pledge_tx).blockNumber || 0)).timestamp
            const boost_duration = boost_end_timestamp.sub(tx_timestamp)

            const boost_slope = deleg_amount1.div(boost_duration)
            const boost_bias = boost_duration.mul(boost_slope)

            // total amount of veBoost delegated (sum for each second of the Boost duration)
            const boost_total_delegated_amount = boost_bias.mul(boost_duration).add(boost_bias).div(2)
            const expected_boost_rewards = boost_total_delegated_amount.mul(new_reward_per_vote).div(UNIT)

            const new_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const new_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            expect(new_pledge_remaining_rewards).to.be.eq(old_pledge_remaining_rewards.sub(expected_boost_rewards))
            expect(new_delegator_balance).to.be.eq(old_delegator_balance.add(expected_boost_rewards))
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(expected_boost_rewards))

            await expect(pledge_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, delegator1.address, expected_boost_rewards);

            await advanceTime(WEEK.mul(boost_week_duration1.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)

        });

        it(' should fail if trying to delegate more than the Pledge target amount', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)

            const deleg_amount2 = ethers.utils.parseEther("525000")

            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)
            ).to.be.revertedWith('TargetVotesOverflow')

            await advanceTime(WEEK.mul(boost_week_duration1.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should fail if delegeable balance is not enough', async () => {

            await delegationBoost.connect(delegator3).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator3).pledge(pledge_id, deleg_amount1, boost_end_timestamp)
            ).to.be.revertedWith('CannotDelegate')

        });

        it(' should fail if given an invalid Pledge ID', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id.add(2), deleg_amount1, boost_end_timestamp)
            ).to.be.revertedWith('InvalidPledgeID')

        });

        it(' should fail if Pledge was closed', async () => {

            await wardenPledge.connect(creator).closePledge(pledge_id, creator.address)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)
            ).to.be.revertedWith('PledgeClosed')

        });

        it(' should fail if Pledge is expired', async () => {

            await advanceTime(WEEK.mul(week_duration.add(1)).toNumber())

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)
            ).to.be.revertedWith('ExpiredPledge')

        });

        it(' should fail if given a null amount', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, 0, boost_end_timestamp)
            ).to.be.revertedWith('NullValue')

        });

        it(' should fail if given an invalid end timestamp', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = current_ts.add(WEEK.mul(boost_week_duration1))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)
            ).to.be.revertedWith('InvalidEndTimestamp')

            const pledge_end_timestamp = (await wardenPledge.pledges(pledge_id)).endTimestamp

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, pledge_end_timestamp.add(WEEK))
            ).to.be.revertedWith('InvalidEndTimestamp')

        });

        it(' should fail if not given enoug allowance to the contract', async () => {

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)
            ).to.be.revertedWith('InsufficientAllowance')

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1.div(2))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp)
            ).to.be.revertedWith('InsufficientAllowance')

        });

    });

    describe('pledgePercent', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        let pledge_id: BigNumber

        const deleg_percent = BigNumber.from('5000')
        const full_deleg_percent = BigNumber.from('10000')
        const boost_week_duration = BigNumber.from(3) 

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            pledge_id = await wardenPledge.pledgesIndex();

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            await advanceTime(WEEK.mul(1).toNumber())

        })

        it(' should delegate the correct percentage of the balance', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, MAX_UINT)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration)))

            const old_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const pledge_tx = await wardenPledge.connect(delegator1).pledgePercent(pledge_id, deleg_percent, boost_end_timestamp)

            const tx_block = (await pledge_tx).blockNumber
            const tx_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp
            const boost_duration = boost_end_timestamp.sub(tx_timestamp)

            const expected_boost_amount = (await veCRV.balanceOf(delegator1.address, { blockTag: tx_block })).mul(deleg_percent).div(MAX_BPS)

            const boost_slope = expected_boost_amount.div(boost_duration)
            const boost_bias = boost_duration.mul(boost_slope)

            expect(await delegationBoost.delegated_balance(delegator1.address, { blockTag: tx_block })).to.be.eq(boost_bias)
            expect(await delegationBoost.received_balance(receiver.address, { blockTag: tx_block })).to.be.eq(boost_bias)

            // total amount of veBoost delegated (sum for each second of the Boost duration)
            const boost_total_delegated_amount = boost_bias.mul(boost_duration).add(boost_bias).div(2)
            const expected_boost_rewards = boost_total_delegated_amount.mul(reward_per_vote).div(UNIT)

            const new_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const new_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            expect(new_pledge_remaining_rewards).to.be.eq(old_pledge_remaining_rewards.sub(expected_boost_rewards))
            expect(new_delegator_balance).to.be.eq(old_delegator_balance.add(expected_boost_rewards))
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(expected_boost_rewards))

            await expect(pledge_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, delegator1.address, expected_boost_rewards);

            await expect(pledge_tx)
                .to.emit(delegationBoost, 'Boost')
                .withArgs(delegator1.address, receiver.address, boost_bias, boost_slope, tx_timestamp);

            await expect(pledge_tx)
                .to.emit(wardenPledge, 'Pledged')
                .withArgs(pledge_id, delegator1.address, expected_boost_amount, boost_end_timestamp);

            await advanceTime(WEEK.mul(boost_week_duration.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)

        });

        it(' should delegate the full balance if given 100%', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, MAX_UINT)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration)))

            const old_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            const pledge_tx = await wardenPledge.connect(delegator1).pledgePercent(pledge_id, full_deleg_percent, boost_end_timestamp)

            const tx_block = (await pledge_tx).blockNumber
            const tx_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp
            const boost_duration = boost_end_timestamp.sub(tx_timestamp)

            const expected_boost_amount = await veCRV.balanceOf(delegator1.address, { blockTag: tx_block })

            const boost_slope = expected_boost_amount.div(boost_duration)
            const boost_bias = boost_duration.mul(boost_slope)

            expect(await delegationBoost.delegated_balance(delegator1.address, { blockTag: tx_block })).to.be.eq(boost_bias)
            expect(await delegationBoost.received_balance(receiver.address, { blockTag: tx_block })).to.be.eq(boost_bias)

            // total amount of veBoost delegated (sum for each second of the Boost duration)
            const boost_total_delegated_amount = boost_bias.mul(boost_duration).add(boost_bias).div(2)
            const expected_boost_rewards = boost_total_delegated_amount.mul(reward_per_vote).div(UNIT)

            const new_pledge_remaining_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const new_delegator_balance = await rewardToken1.balanceOf(delegator1.address)
            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)

            expect(new_pledge_remaining_rewards).to.be.eq(old_pledge_remaining_rewards.sub(expected_boost_rewards))
            expect(new_delegator_balance).to.be.eq(old_delegator_balance.add(expected_boost_rewards))
            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(expected_boost_rewards))

            await expect(pledge_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, delegator1.address, expected_boost_rewards);

            await expect(pledge_tx)
                .to.emit(delegationBoost, 'Boost')
                .withArgs(delegator1.address, receiver.address, boost_bias, boost_slope, tx_timestamp);

            await expect(pledge_tx)
                .to.emit(wardenPledge, 'Pledged')
                .withArgs(pledge_id, delegator1.address, expected_boost_amount, boost_end_timestamp);

            await advanceTime(WEEK.mul(boost_week_duration.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)

        });

        it(' should fail if given more than 10_000 BPS', async () => {

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, MAX_UINT)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration)))

            await expect(
                wardenPledge.connect(delegator1).pledgePercent(pledge_id, 10100, boost_end_timestamp)
            ).to.be.revertedWith("PercentOverMax")

            await expect(
                wardenPledge.connect(delegator1).pledgePercent(pledge_id, 15000, boost_end_timestamp)
            ).to.be.revertedWith("PercentOverMax")

            await expect(
                wardenPledge.connect(delegator1).pledgePercent(pledge_id, 0, boost_end_timestamp)
            ).to.be.revertedWith("NullValue")

        });

    });

    describe('retrievePledgeRewards', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        let pledge_id: BigNumber

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            pledge_id = await wardenPledge.pledgesIndex();

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            await advanceTime(WEEK.mul(1).toNumber())

        })

        it(' should return all non-distributed rewards to the give naddresse (& emit Event)', async () => {

            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3) 

            const deleg_amount2 = ethers.utils.parseEther("200000")
            const boost_week_duration2 = BigNumber.from(2)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))
            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration2)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            await advanceTime(WEEK.mul(week_duration).toNumber())

            const non_distributed_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const old_creator_balance = await rewardToken1.balanceOf(creator.address)

            const retrieve_tx = await wardenPledge.connect(creator).retrievePledgeRewards(pledge_id, creator.address)

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const new_creator_balance = await rewardToken1.balanceOf(creator.address)

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)).to.be.eq(0)

            expect((await wardenPledge.pledges(pledge_id)).closed).to.be.true

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(non_distributed_rewards))
            expect(new_creator_balance).to.be.eq(old_creator_balance.add(non_distributed_rewards))

            await expect(retrieve_tx)
                .to.emit(wardenPledge, 'RetrievedPledgeRewards')
                .withArgs(pledge_id, creator.address, non_distributed_rewards);

            await expect(retrieve_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, creator.address, non_distributed_rewards);

            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should return all total rewards if no user pledged to the Pledge', async () => {

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken2.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken2.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const pledge_id2 = await wardenPledge.pledgesIndex();

            const create_tx = await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken2.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration = end_timestamp.sub(tx_timestamp)
            const real_total_reward_amount = target_votes.mul(reward_per_vote).mul(real_duration).div(UNIT)

            await advanceTime(WEEK.mul(week_duration.add(1)).toNumber())

            const old_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)
            const old_creator_balance = await rewardToken2.balanceOf(creator.address)

            const retrieve_tx = await wardenPledge.connect(creator).retrievePledgeRewards(pledge_id2, creator.address)

            const new_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)
            const new_creator_balance = await rewardToken2.balanceOf(creator.address)

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id2)).to.be.eq(0)

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(real_total_reward_amount))
            expect(new_creator_balance).to.be.eq(old_creator_balance.add(real_total_reward_amount))

            await expect(retrieve_tx)
                .to.emit(wardenPledge, 'RetrievedPledgeRewards')
                .withArgs(pledge_id2, creator.address, real_total_reward_amount);

            await expect(retrieve_tx)
                .to.emit(rewardToken2, 'Transfer')
                .withArgs(wardenPledge.address, creator.address, real_total_reward_amount);

        });

        it(' should wait the end of the Pledge to return rewards', async () => {

            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3) 

            const deleg_amount2 = ethers.utils.parseEther("200000")
            const boost_week_duration2 = BigNumber.from(2)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))
            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration2)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            await expect(
                wardenPledge.connect(creator).retrievePledgeRewards(pledge_id, creator.address)
            ).to.be.revertedWith('PledgeNotExpired')

            await advanceTime(WEEK.mul(week_duration.add(1)).toNumber())
            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should not return anything if no more rewards to return (already claimed or all used)', async () => {

            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3) 

            const deleg_amount2 = ethers.utils.parseEther("200000")
            const boost_week_duration2 = BigNumber.from(2)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))
            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration2)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            await advanceTime(WEEK.mul(week_duration).toNumber())

            await wardenPledge.connect(creator).retrievePledgeRewards(pledge_id, creator.address)

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)).to.be.eq(0)

            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const old_creator_balance = await rewardToken1.balanceOf(creator.address)

            const retrieve_tx = await wardenPledge.connect(creator).retrievePledgeRewards(pledge_id, creator.address)

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const new_creator_balance = await rewardToken1.balanceOf(creator.address)

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)).to.be.eq(0)

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance)
            expect(new_creator_balance).to.be.eq(old_creator_balance)

            await expect(retrieve_tx).not.to.emit(rewardToken1, 'Transfer')
            await expect(retrieve_tx).not.to.emit(wardenPledge, 'RetrievedPledgeRewards')

            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should send the reward to the correct receiver ', async () => {

            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3) 

            const deleg_amount2 = ethers.utils.parseEther("200000")
            const boost_week_duration2 = BigNumber.from(2)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))
            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration2)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            await advanceTime(WEEK.mul(week_duration).toNumber())

            const non_distributed_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const old_receiver_balance = await rewardToken1.balanceOf(receiver.address)

            const retrieve_tx = await wardenPledge.connect(creator).retrievePledgeRewards(pledge_id, receiver.address)

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const new_receiver_balance = await rewardToken1.balanceOf(receiver.address)

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)).to.be.eq(0)

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(non_distributed_rewards))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(non_distributed_rewards))

            await expect(retrieve_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, receiver.address, non_distributed_rewards);

            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should only be callable by the creator', async () => {

            await advanceTime(WEEK.mul(week_duration).toNumber())

            await expect(
                wardenPledge.connect(delegator1).retrievePledgeRewards(pledge_id, delegator1.address)
            ).to.be.revertedWith('NotPledgeCreator')

            await expect(
                wardenPledge.connect(admin).retrievePledgeRewards(pledge_id, admin.address)
            ).to.be.revertedWith('NotPledgeCreator')

        });

        it(' should fail if given an incorrect Pledge ID', async () => {

            await advanceTime(WEEK.mul(week_duration).toNumber())

            await expect(
                wardenPledge.connect(creator).retrievePledgeRewards(pledge_id.add(12), creator.address)
            ).to.be.revertedWith('InvalidPledgeID')

        });

        it(' should fail if given the addresse 0x0', async () => {

            await advanceTime(WEEK.mul(week_duration).toNumber())

            await expect(
                wardenPledge.connect(creator).retrievePledgeRewards(pledge_id, ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

        });

    });

    describe('closePledge', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        let pledge_id: BigNumber

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            pledge_id = await wardenPledge.pledgesIndex();

            await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken1.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            await advanceTime(WEEK.mul(1).toNumber())

        })

        it(' should return all non-distributed rewards to the give naddresse (& emit Event)', async () => {

            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3) 

            const deleg_amount2 = ethers.utils.parseEther("200000")
            const boost_week_duration2 = BigNumber.from(2)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))
            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration2)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            const non_distributed_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const old_creator_balance = await rewardToken1.balanceOf(creator.address)

            const close_tx = await wardenPledge.connect(creator).closePledge(pledge_id, creator.address)

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const new_creator_balance = await rewardToken1.balanceOf(creator.address)

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)).to.be.eq(0)

            expect((await wardenPledge.pledges(pledge_id)).closed).to.be.true

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(non_distributed_rewards))
            expect(new_creator_balance).to.be.eq(old_creator_balance.add(non_distributed_rewards))

            await expect(close_tx)
                .to.emit(wardenPledge, 'ClosePledge')
                .withArgs(pledge_id);

            await expect(close_tx)
                .to.emit(wardenPledge, 'RetrievedPledgeRewards')
                .withArgs(pledge_id, creator.address, non_distributed_rewards);

            await expect(close_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, creator.address, non_distributed_rewards);

            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should close the Pledge and return all total rewards if no user pledged to the Pledge', async () => {

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken2.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken2.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            const pledge_id2 = await wardenPledge.pledgesIndex();

            const create_tx = await wardenPledge.connect(creator).createPledge(
                receiver.address,
                rewardToken2.address,
                target_votes,
                reward_per_vote,
                end_timestamp,
                max_total_reward_amount,
                max_fee_amount
            )

            const tx_timestamp = (await ethers.provider.getBlock((await create_tx).blockNumber || 0)).timestamp
            const real_duration = end_timestamp.sub(tx_timestamp)
            const real_total_reward_amount = target_votes.mul(reward_per_vote).mul(real_duration).div(UNIT)

            const old_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)
            const old_creator_balance = await rewardToken2.balanceOf(creator.address)

            const close_tx = await wardenPledge.connect(creator).closePledge(pledge_id2, creator.address)

            const new_wardenPledge_balance = await rewardToken2.balanceOf(wardenPledge.address)
            const new_creator_balance = await rewardToken2.balanceOf(creator.address)

            expect((await wardenPledge.pledges(pledge_id2)).closed).to.be.true

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id2)).to.be.eq(0)

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(real_total_reward_amount))
            expect(new_creator_balance).to.be.eq(old_creator_balance.add(real_total_reward_amount))

            await expect(close_tx)
                .to.emit(wardenPledge, 'ClosePledge')
                .withArgs(pledge_id2);

            await expect(close_tx)
                .to.emit(wardenPledge, 'RetrievedPledgeRewards')
                .withArgs(pledge_id2, creator.address, real_total_reward_amount);

            await expect(close_tx)
                .to.emit(rewardToken2, 'Transfer')
                .withArgs(wardenPledge.address, creator.address, real_total_reward_amount);

        });

        it(' should fail if already closed', async () => {

            await wardenPledge.connect(creator).closePledge(pledge_id, creator.address)

            expect((await wardenPledge.pledges(pledge_id)).closed).to.be.true

            await expect(
                wardenPledge.connect(creator).closePledge(pledge_id, creator.address)
            ).to.be.revertedWith('PledgeAlreadyClosed')

        });

        it(' should block further user to join the Pledge', async () => {

            await wardenPledge.connect(creator).closePledge(pledge_id, creator.address)

            const deleg_amount = ethers.utils.parseEther('1250000')

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp = getRoundedTimestamp(current_ts.add(WEEK.mul(2)))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount, boost_end_timestamp)
            ).to.be.revertedWith('PledgeClosed')

        });

        it(' should fail if pledge already expired', async () => {

            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3) 

            const deleg_amount2 = ethers.utils.parseEther("200000")
            const boost_week_duration2 = BigNumber.from(2)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))
            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration2)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            await advanceTime(WEEK.mul(week_duration).toNumber())

            await expect(
                wardenPledge.connect(creator).closePledge(pledge_id, creator.address)
            ).to.be.revertedWith('ExpiredPledge')

        });

        it(' should send the reward to the correct receiver ', async () => {

            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3) 

            const deleg_amount2 = ethers.utils.parseEther("200000")
            const boost_week_duration2 = BigNumber.from(2)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)
            await delegationBoost.connect(delegator2).approve(wardenPledge.address, deleg_amount2)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))
            const boost_end_timestamp2 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration2)))

            await wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            await wardenPledge.connect(delegator2).pledge(pledge_id, deleg_amount2, boost_end_timestamp2)

            const non_distributed_rewards = await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)
            const old_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const old_receiver_balance = await rewardToken1.balanceOf(receiver.address)

            const close_tx = await wardenPledge.connect(creator).closePledge(pledge_id, receiver.address)

            const new_wardenPledge_balance = await rewardToken1.balanceOf(wardenPledge.address)
            const new_receiver_balance = await rewardToken1.balanceOf(receiver.address)

            expect((await wardenPledge.pledges(pledge_id)).closed).to.be.true

            expect(await wardenPledge.pledgeAvailableRewardAmounts(pledge_id)).to.be.eq(0)

            expect(new_wardenPledge_balance).to.be.eq(old_wardenPledge_balance.sub(non_distributed_rewards))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(non_distributed_rewards))

            await expect(close_tx)
                .to.emit(rewardToken1, 'Transfer')
                .withArgs(wardenPledge.address, receiver.address, non_distributed_rewards);

            await delegationBoost.connect(delegator1).checkpoint_user(delegator1.address)
            await delegationBoost.connect(delegator2).checkpoint_user(delegator2.address)

        });

        it(' should only be callable by the creator', async () => {

            await expect(
                wardenPledge.connect(delegator1).closePledge(pledge_id, delegator1.address)
            ).to.be.revertedWith('NotPledgeCreator')

            await expect(
                wardenPledge.connect(admin).closePledge(pledge_id, admin.address)
            ).to.be.revertedWith('NotPledgeCreator')

        });

        it(' should fail if given an incorrect Pledge ID', async () => {

            await expect(
                wardenPledge.connect(creator).closePledge(pledge_id.add(12), creator.address)
            ).to.be.revertedWith('InvalidPledgeID')

        });

        it(' should fail if given the addresse 0x0', async () => {

            await expect(
                wardenPledge.connect(creator).closePledge(pledge_id, ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

        });

    });

    describe('updateChest', async () => {

        it(' should update correctly (& emit Event)', async () => {

            const update_tx = await wardenPledge.connect(admin).updateChest(receiver.address)

            expect(await wardenPledge.chestAddress()).to.be.eq(receiver.address)

            await expect(update_tx)
                .to.emit(wardenPledge, 'ChestUpdated')
                .withArgs(chest.address, receiver.address);

        });

        it(' should fail if given incorrect params', async () => {

            await expect(
                wardenPledge.connect(admin).updateChest(ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                wardenPledge.connect(creator).updateChest(receiver.address)
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

    });

    describe('updateMinTargetVotes', async () => {

        const new_min_target_votes = ethers.utils.parseEther('1500')

        it(' should update correctly (& emit Event)', async () => {

            const update_tx = await wardenPledge.connect(admin).updateMinTargetVotes(new_min_target_votes)

            expect(await wardenPledge.minTargetVotes()).to.be.eq(new_min_target_votes)

            await expect(update_tx)
                .to.emit(wardenPledge, 'MinTargetUpdated')
                .withArgs(min_target_votes, new_min_target_votes);

        });

        it(' should fail if given incorrect params', async () => {

            await expect(
                wardenPledge.connect(admin).updateMinTargetVotes(0)
            ).to.be.revertedWith('InvalidValue')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                wardenPledge.connect(creator).updateMinTargetVotes(new_min_target_votes)
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

    });

    describe('updatePlatformFee', async () => {

        const new_platform_fees = 450

        it(' should update correctly (& emit Event)', async () => {

            const old_platform_fee = await wardenPledge.protocalFeeRatio()

            const update_tx = await wardenPledge.connect(admin).updatePlatformFee(new_platform_fees)

            expect(await wardenPledge.protocalFeeRatio()).to.be.eq(new_platform_fees)

            await expect(update_tx)
                .to.emit(wardenPledge, 'PlatformFeeUpdated')
                .withArgs(old_platform_fee, new_platform_fees);

        });

        it(' should fail if given incorrect params', async () => {

            await expect(
                wardenPledge.connect(admin).updatePlatformFee(600)
            ).to.be.revertedWith('InvalidValue')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                wardenPledge.connect(creator).updatePlatformFee(new_platform_fees)
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

    });

    describe('pause & unpause', async () => {

        const target_votes = ethers.utils.parseEther("750000")
        const reward_per_vote = ethers.utils.parseEther('0.000000015')
        const week_duration = BigNumber.from(6)

        let end_timestamp: BigNumber
        let max_total_reward_amount: BigNumber
        let max_fee_amount: BigNumber

        let pledge_id: BigNumber

        beforeEach(async () => {

            await wardenPledge.connect(admin).addMultipleRewardToken(
                [rewardToken1.address, rewardToken2.address],
                min_reward_per_vote
            )

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            end_timestamp = current_ts.add(WEEK.mul(week_duration))
            // rounding down, so it will end before the exact week_duration given
            end_timestamp = getRoundedTimestamp(end_timestamp)
            const duration = end_timestamp.sub(current_ts)
            max_total_reward_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)
            const fee_ratio = await wardenPledge.protocalFeeRatio()
            max_fee_amount = max_total_reward_amount.mul(fee_ratio).div(MAX_BPS)

            await rewardToken1.connect(admin).transfer(creator.address, max_total_reward_amount.add(max_fee_amount).mul(2))

            await rewardToken1.connect(creator).approve(wardenPledge.address, max_total_reward_amount.add(max_fee_amount))

            pledge_id = await wardenPledge.pledgesIndex();

        })

        it(' should allow admin to pause the contract', async () => {

            await wardenPledge.connect(admin).pause();

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).to.be.revertedWith("Pausable: paused")


            const deleg_amount1 = ethers.utils.parseEther("350000")
            const boost_week_duration1 = BigNumber.from(3)

            await delegationBoost.connect(delegator1).approve(wardenPledge.address, deleg_amount1)

            const current_ts = BigNumber.from((await provider.getBlock(await provider.getBlockNumber())).timestamp)
            const boost_end_timestamp1 = getRoundedTimestamp(current_ts.add(WEEK.mul(boost_week_duration1)))

            await expect(
                wardenPledge.connect(delegator1).pledge(pledge_id, deleg_amount1, boost_end_timestamp1)
            ).to.be.revertedWith("Pausable: paused")

        });

        it(' should allow the admin to unpause the contract', async () => {

            await wardenPledge.connect(admin).pause();

            await wardenPledge.connect(admin).unpause();

            await expect(
                wardenPledge.connect(creator).createPledge(
                    receiver.address,
                    rewardToken1.address,
                    target_votes,
                    reward_per_vote,
                    end_timestamp,
                    max_total_reward_amount,
                    max_fee_amount
                )
            ).not.to.be.reverted

        });

        it(' should block non-admin caller', async () => {

            await expect(
                wardenPledge.connect(externalUser).pause()
            ).to.be.reverted

            await expect(
                wardenPledge.connect(externalUser).unpause()
            ).to.be.reverted

        });

    });

    describe('recoverERC20', async () => {

        const lost_amount = ethers.utils.parseEther('1000');

        beforeEach(async () => {

            await CRV.connect(admin).transfer(wardenPledge.address, lost_amount)

        });


        it(' should retrieve the lost tokens and send it to the admin', async () => {

            const oldBalance = await CRV.balanceOf(admin.address);

            await wardenPledge.connect(admin).recoverERC20(CRV.address)

            const newBalance = await CRV.balanceOf(admin.address);

            expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

        });

        it(' should fail for whitelisted tokens', async () => {

            await wardenPledge.connect(admin).addRewardToken(CRV.address, ethers.utils.parseEther('0.000005'))

            await expect(
                wardenPledge.connect(admin).recoverERC20(CRV.address)
            ).to.be.revertedWith('CannotRecoverToken')

        });

        it(' should block non-admin caller', async () => {

            await expect(
                wardenPledge.connect(creator).recoverERC20(CRV.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });

});
