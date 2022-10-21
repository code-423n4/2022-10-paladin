// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

library Errors {

    // Access Errors
    error CallerNotAllowed();
    error CallerNotManager();

    // Common Errors
    error ZeroAddress();
    error NullValue();
    error InvalidValue();
    error InequalArraySizes();
    error EmptyArray();

    // Admin Errors
    error AlreadyAllowedToken();
    error NotAllowedToken();
    error CannotRecoverToken();

    //PledgeErrors
    error TokenNotWhitelisted();
    error RewardPerVoteTooLow();
    error TargetVoteUnderMin();
    error IncorrectMaxTotalRewardAmount();
    error IncorrectMaxFeeAmount();
    error InvalidEndTimestamp();
    error NullEndTimestamp();
    error NotPledgeCreator();
    error ExpiredPledge();
    error PledgeNotExpired();
    error PledgeClosed();
    error PledgeAlreadyClosed();
    error TargetVotesTooLoow();
    error RewardsPerVotesTooLow();
    error InvalidPledgeID();
    error TargetVotesOverflow();
    error RewardsBalanceTooLow();
    error PercentOverMax();
    error CannotDelegate();
    error DurationTooShort();

    // Math Errors
    error NumberExceed64Bits();

}