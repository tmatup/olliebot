exports.inputSchema = z.object({
  userPick: z
    .number()
    .int()
    .min(1)
    .max(1000000)
    .optional()
});

exports.default = function (input) {
  try {
    const min = 1;
    const max = 1000000;

    const winnerNumber = Math.floor(Math.random() * (max - min + 1)) + min;

    let userPick = input && typeof input.userPick !== "undefined" ? input.userPick : undefined;
    if (typeof userPick === "undefined" || userPick === null) {
      userPick = Math.floor(Math.random() * (max - min + 1)) + min;
    }

    if (!Number.isFinite(userPick) || Math.floor(userPick) !== userPick || userPick < min || userPick > max) {
      return { error: "userPick must be an integer between 1 and 1,000,000." };
    }

    const isWinner = userPick === winnerNumber;

    return {
      isWinner: isWinner,
      userPick: userPick,
      winnerNumber: winnerNumber,
      message: isWinner
        ? "Congratulations! Your pick matches the winning number. You won the lottery!"
        : "Sorry, your pick did not match the winning number. Better luck next time!"
    };
  } catch (e) {
    return { error: (e && e.message) ? e.message : "Unknown error" };
  }
};