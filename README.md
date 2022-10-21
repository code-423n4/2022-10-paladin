# ✨ So you want to sponsor a contest

This `README.md` contains a set of checklists for our contest collaboration.

Your contest will use two repos: 
- **a _contest_ repo** (this one), which is used for scoping your contest and for providing information to contestants (wardens)
- **a _findings_ repo**, where issues are submitted (shared with you after the contest) 

Ultimately, when we launch the contest, this contest repo will be made public and will contain the smart contracts to be reviewed and all the information needed for contest participants. The findings repo will be made public after the contest report is published and your team has mitigated the identified issues.

Some of the checklists in this doc are for **C4 (🐺)** and some of them are for **you as the contest sponsor (⭐️)**.

---

# Contest setup

## ⭐️ Sponsor: Provide contest details

Under "SPONSORS ADD INFO HERE" heading below, include the following:

- [x] Create a PR to this repo with the below changes:
- [x] Name of each contract and:
  - [x] source lines of code (excluding blank lines and comments) in each
  - [x] external contracts called in each
  - [x] libraries used in each
- [x] Describe any novel or unique curve logic or mathematical models implemented in the contracts
- [x] Does the token conform to the ERC-20 standard? In what specific ways does it differ?
- [x] Describe anything else that adds any special logic that makes your approach unique
- [x] Identify any areas of specific concern in reviewing the code
- [x] Add all of the code to this repo that you want reviewed


---

# Contest prep

## ⭐️ Sponsor: Contest prep
- [x] Provide a self-contained repository with working commands that will build (at least) all in-scope contracts, and commands that will run tests producing gas reports for the relevant contracts.
- [ ] Make sure your code is thoroughly commented using the [NatSpec format](https://docs.soliditylang.org/en/v0.5.10/natspec-format.html#natspec-format).
- [x] Modify the bottom of this `README.md` file to describe how your code is supposed to work with links to any relevent documentation and any other criteria/details that the C4 Wardens should keep in mind when reviewing. ([Here's a well-constructed example.](https://github.com/code-423n4/2021-06-gro/blob/main/README.md))
- [x] Please have final versions of contracts and documentation added/updated in this repo **no less than 24 hours prior to contest start time.**
- [x] Be prepared for a 🚨code freeze🚨 for the duration of the contest — important because it establishes a level playing field. We want to ensure everyone's looking at the same code, no matter when they look during the contest. (Note: this includes your own repo, since a PR can leak alpha to our wardens!)
- [ ] Promote the contest on Twitter (optional: tag in relevant protocols, etc.)
- [ ] Share it with your own communities (blog, Discord, Telegram, email newsletters, etc.)
- [ ] Optional: pre-record a high-level overview of your protocol (not just specific smart contract functions). This saves wardens a lot of time wading through documentation.
- [ ] Delete this checklist and all text above the line below when you're ready.

---

# Paladin - Warden Pledges contest details
- $28,500 USDC main award pot
- $1,500 USDC gas optimization award pot
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2022-10-paladin-warden-pledges-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts October 27, 2022 20:00 UTC
- Ends October 30, 2022 20:00 UTC


## Smart Contracts

There is only 1 contract in the scope of this contest: `WardenPledge`

### WardenPledge (410 sloc)

ardenPledge is a contract supposed to receive ERC20 incentives (ERC20 tokens must be whitelsited before being deposited) that will be distributed to users that delegate veCRV boost power (using the Boostv2 contract) through the Warden Pledge contract. DAOs/Protocols/etc.. will be able to set a Pledge with a given reward per vote delegated, for a fixed duration, and pay only for the boost effectively received (delegators rewards calculations take in account the boost delegation decrease over time).  
For more infos, see "System Overview".  

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
- To `Boostv2` (`0xD0921691C7DEBc698e6e372c6f74dc01fc9d3778`):
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

New version of the Warden Market, based on a mix between the current Warden Market and Warden Quest base logic (see our [Docs](doc.paladin.vote) for more infos on Warden & Quest).  
  
Reward tokens (`ERC20`) must be whitelisted before being used as a rewards for Pledges.  
Pledges have a target amount of veCRV to reach (sum of the receiving address veCRV balance + any veCRV delegated through the veBoost system) and an amount of rewards for each veCRV delegated through the Pledge. Users joining the Pledge (delegating to the Pledge receiver address) will always receive a fix amount rewards, based on the decreasing amount of veCRV delegated in their Boost (meaning that for a Boost of 100 veCRV over 2 weeks, the user rewards are calculated based on the decrease from 100 to 0 delegated through the 2 weeks).  
Each Pledge has an `end timestamp` after which the Pledge is `expired` and will not accept any new delegation, and all Boost for that Pledge will also end at maximum at that `end timestamp`. Pledge's creators can also close a Pledge before it is `expired`, and retrieve all undistributed rewards. All undistributed rewards from the Pledge can also be retrieved after the Pledge is `expired`.  
All rewards for delegation are paid when the user joins the Pledge, because the veBoost is not cancelable.  
  
!! This contract cannot update the receiver Gauge checkpoints when receiving new delegated veBoost (so the newly delegated amount is accounted for CRV farming in Gauges), and will require an update to be done manually.  


## Set up environment

To start, make sure you have `node` & `npm` installed : 
* `node` - tested with v16
* `npm` - tested with v8.1

Then, copy `.env.example` and fill all varaibles.  

Then, run :  
```
npm install
```
This will install `Hardhat`, `Ethers v5`, and all the hardhat plugins used in this project.


## Tests

Tests can be found in the `./test` directory.

To run the tests : 
```
npm run build
npm run test
```

