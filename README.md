# Paladin - Warden Pledges contest details
- Total Prize Pool: $33,500 USDC
  - HM awards: $25,500 USDC
  - QA report awards: $3,000 USDC
  - Gas report awards: $1,500 USDC
  - Judge + presort awards: $3,000 USDC
  - Scout awards: $500 USDC
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2022-10-paladin-warden-pledges-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts October 27, 2022 20:00 UTC
- Ends October 30, 2022 20:00 UTC


## Description 

Paladin builds different products revolving around tokenomics, voting power delegation & veTokens (more info on the [website](https://paladin.vote)). Warden is a system focusing on veTokens, with the Warden Boost market to purchase boosting power from veCRV holders to optimize your Curve LP rewards distribution, and Quest to offer a better system for Gauge votes acquisition (more info on Quest [here](https://doc.paladin.vote/warden-quest/introduction)).
This Contest is aimed at the new piece to be added to the Warden system, called Pledge, with the goal of providing another type of marketplace for veCRV boosting power, through a new logic that mixes pieces from the Boost market and from Quest.
(The Pledge smart contract is based on the logic of Curve's veBoost, by using the BoostV2 contract to delegate boosting power that has been approved to Warden Pledge by the veCRV holder. The Curve veBoost contracts & tests can be found [here](https://github.com/curvefi/curve-veBoost)).


## Scope
### Files in scope
|File|[SLOC](#nowhere "(nSLOC, SLOC, Lines)")|[Coverage](#nowhere "(Lines hit / Total)")|
|:-|:-:|:-:|
|_Contracts (1)_|
|[contracts/WardenPledge.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/WardenPledge.sol) [Σ](#nowhere "Unchecked Blocks")|[317](#nowhere "(nSLOC:299, SLOC:317, Lines:671)")|[100.00%](#nowhere "(Hit:164 / Total:164)")|
|Total (over 1 file):| [317](#nowhere "(nSLOC:299, SLOC:317, Lines:671)")| [100.00%](#nowhere "Hit:164 / Total:164")|


### All other source contracts (not in scope)
|File|[SLOC](#nowhere "(nSLOC, SLOC, Lines)")|[Coverage](#nowhere "(Lines hit / Total)")|
|:-|:-:|:-:|
|_Contracts (1)_|
|[contracts/utils/Owner.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/utils/Owner.sol)|[23](#nowhere "(nSLOC:23, SLOC:23, Lines:38)")|-|
|_Abstracts (4)_|
|[contracts/oz/utils/Context.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/oz/utils/Context.sol)|[9](#nowhere "(nSLOC:9, SLOC:9, Lines:24)")|-|
|[contracts/oz/utils/ReentrancyGuard.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/oz/utils/ReentrancyGuard.sol)|[15](#nowhere "(nSLOC:15, SLOC:15, Lines:63)")|-|
|[contracts/oz/utils/Ownable.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/oz/utils/Ownable.sol)|[31](#nowhere "(nSLOC:31, SLOC:31, Lines:83)")|-|
|[contracts/oz/utils/Pausable.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/oz/utils/Pausable.sol)|[35](#nowhere "(nSLOC:35, SLOC:35, Lines:105)")|-|
|_Libraries (3)_|
|[contracts/utils/Errors.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/utils/Errors.sol)|[35](#nowhere "(nSLOC:35, SLOC:35, Lines:48)")|-|
|[contracts/oz/libraries/SafeERC20.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/oz/libraries/SafeERC20.sol) [Σ](#nowhere "Unchecked Blocks")|[58](#nowhere "(nSLOC:37, SLOC:58, Lines:98)")|-|
|[contracts/oz/utils/Address.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/oz/utils/Address.sol) [🖥](#nowhere "Uses Assembly") [👥](#nowhere "DelegateCall")|[81](#nowhere "(nSLOC:56, SLOC:81, Lines:222)")|-|
|_Interfaces (3)_|
|[contracts/interfaces/IVotingEscrow.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/interfaces/IVotingEscrow.sol)|[13](#nowhere "(nSLOC:13, SLOC:13, Lines:25)")|-|
|[contracts/oz/interfaces/IERC20.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/oz/interfaces/IERC20.sol)|[15](#nowhere "(nSLOC:11, SLOC:15, Lines:82)")|-|
|[contracts/interfaces/IBoostV2.sol](https://github.com/code-423n4/2022-10-paladin/blob/main/contracts/interfaces/IBoostV2.sol)|[19](#nowhere "(nSLOC:19, SLOC:19, Lines:27)")|-|
|Total (over 11 files):| [334](#nowhere "(nSLOC:284, SLOC:334, Lines:815)")| -|


## Smart Contracts

There is only 1 contract in the scope of this contest: `WardenPledge`

### WardenPledge (317 sloc)

WardenPledge is a contract supposed to receive ERC20 incentives (ERC20 tokens must be whitelisted before being deposited) that will be distributed to users that delegate veCRV boost power (using the Boostv2 contract) through the Warden Pledge contract. DAOs/Protocols/etc.. will be able to set a Pledge with a given reward per vote delegated, for a fixed duration, and pay only for the boost effectively received (delegators rewards calculations take in account the boost delegation decrease over time).  
For more info, see "System Overview".  

External Calls:
- To `ERC20` contracts (through the `SafeERC20` lib):
  - line 270: `IERC20(pledgeParams.rewardToken).safeTransfer(user, rewardAmount);`
  - line 332: `IERC20(rewardToken).safeTransferFrom(creator, address(this), vars.totalRewardAmount);`
  - line 334: `IERC20(rewardToken).safeTransferFrom(creator, chestAddress, vars.feeAmount);`
  - line 393: `IERC20(pledgeParams.rewardToken).safeTransferFrom(creator, address(this), totalRewardAmount);`
  - line 395: `IERC20(pledgeParams.rewardToken).safeTransferFrom(creator, chestAddress, feeAmount);`
  - line 437: `IERC20(pledgeParams.rewardToken).safeTransferFrom(creator, address(this), totalRewardAmount);`
  - line 439: `IERC20(pledgeParams.rewardToken).safeTransferFrom(creator, chestAddress, feeAmount);`
  - line 474: `IERC20(pledgeParams.rewardToken).safeTransfer(receiver, remainingAmount);`
  - line 507: `IERC20(pledgeParams.rewardToken).safeTransfer(receiver, remainingAmount);`
  - line 655: `IERC20(token).balanceOf(address(this));`
  - line 657: `IERC20(token).safeTransfer(owner(), amount);`
- To `veCRV` (`0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2`):
  - line 209: `uint256 amount = (votingEscrow.balanceOf(msg.sender) * percent) / MAX_PCT;`
  - line 324: `vars.votesDifference = targetVotes - votingEscrow.balanceOf(receiver);`
- To `BoostV2` (`0xD0921691C7DEBc698e6e372c6f74dc01fc9d3778`):
  - line 240: `delegationBoost.checkpoint_user(user);`
  - line 241: `delegationBoost.delegable_balance(user)`
  - line 244: `delegationBoost.adjusted_balance_of(pledgeParams.receiver);`
  - line 247-252: `delegationBoost.boost(pledgeParams.receiver,amount,endTimestamp,user);`
  
Libraires & Dependencies:
- `IERC20.sol` (openzeppelin)
- `SafeERC20.sol` (openzeppelin)
- `Ownable.sol` (openzeppelin) => turned into 2-step system in `Owner.sol`
- `Pausable.sol` (openzeppelin)
- `ReentrancyGuard.sol` (openzeppelin)

## System Overview

New version of the Warden Boost Market, based on a mix between the current Warden v2 logic and Warden Quest base logic (see our [Docs](https://doc.paladin.vote) for more info on Warden & Quest).  
  
Reward tokens (`ERC20`) must be whitelisted before being used as a rewards for Pledges.  
Pledges have a target amount of veCRV to reach (sum of the receiving address veCRV balance + any veCRV delegated through the veBoost system) and an amount of rewards for each veCRV delegated through the Pledge. Users joining the Pledge (delegating to the Pledge receiver address) will always receive a fix amount rewards, based on the decreasing amount of veCRV delegated in their Boost (meaning that for a Boost of 100 veCRV over 2 weeks, the user rewards are calculated based on the decrease from 100 to 0 delegated through the 2 weeks).  
Each Pledge has an `end timestamp` after which the Pledge is `expired` and will not accept any new delegation, and all Boost for that Pledge will also end at maximum at that `end timestamp`. Pledge's creators can also close a Pledge before it is `expired`, and retrieve all undistributed rewards. All undistributed rewards from the Pledge can also be retrieved after the Pledge is `expired`.  
All rewards for delegation are paid when the user joins the Pledge, because the veBoost is not cancelable.  
  
!! This contract cannot update the receiver Gauge checkpoints when receiving new delegated veBoost (so the newly delegated amount is accounted for CRV farming in Gauges), and will require an update to be done manually.  


## Set up environment

To start, make sure you have `node` & `npm` installed : 
* `node` - tested with v16
* `npm` - tested with v8.1

Then, copy `.env.example` and fill all variables.  

Then, run :  
```
npm install
```
This will install `Hardhat`, `Ethers v5`, and all the hardhat plugins used in this project.


## Tests

! Follow the steps in "Set up environment" before trying to run the tests.  

Tests can be found in the `./test` directory.

To run the tests : 
```
npm run build
npm run test
```

